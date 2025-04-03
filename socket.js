const jwt = require("jsonwebtoken")
const User = require("./models/User")
const Deal = require("./models/Deal")
const Message = require("./models/Message")
const Notification = require("./models/Notification")

module.exports = (io, redisClient) => {
  // Authentication middleware for Socket.io
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token

      if (!token) {
        return next(new Error("Authentication error: Token not provided"))
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      const user = await User.findById(decoded.id).select("-password")

      if (!user) {
        return next(new Error("Authentication error: User not found"))
      }

      socket.user = user
      next()
    } catch (error) {
      return next(new Error("Authentication error: Invalid token"))
    }
  })

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.user.name} (${socket.user._id})`)

    // Join user's personal room for notifications
    socket.join(`user:${socket.user._id}`)

    // Handle joining a deal room
    socket.on("join_deal", async ({ dealId }) => {
      try {
        const deal = await Deal.findById(dealId)

        if (!deal) {
          socket.emit("error", { message: "Deal not found" })
          return
        }

        // Check if user is part of the deal
        const isParticipant =
          deal.buyer.toString() === socket.user._id.toString() ||
          (deal.seller && deal.seller.toString() === socket.user._id.toString())

        if (!isParticipant && socket.user.role !== "admin") {
          socket.emit("error", { message: "Not authorized to join this deal" })
          return
        }

        socket.join(`deal:${dealId}`)
        console.log(`${socket.user.name} joined deal room: ${dealId}`)

        // Store active users in Redis if available
        if (redisClient) {
          await redisClient.sadd(`deal:${dealId}:users`, socket.user._id.toString())

          // Set expiry for the set (24 hours)
          await redisClient.expire(`deal:${dealId}:users`, 60 * 60 * 24)
        }
      } catch (error) {
        console.error("Error joining deal room:", error)
        socket.emit("error", { message: "Error joining deal room" })
      }
    })

    // Handle leaving a deal room
    socket.on("leave_deal", async ({ dealId }) => {
      socket.leave(`deal:${dealId}`)
      console.log(`${socket.user.name} left deal room: ${dealId}`)

      // Remove user from active users in Redis if available
      if (redisClient) {
        await redisClient.srem(`deal:${dealId}:users`, socket.user._id.toString())
      }
    })

    // Handle sending a message
    socket.on("send_message", async ({ dealId, message }) => {
      try {
        const deal = await Deal.findById(dealId)

        if (!deal) {
          socket.emit("error", { message: "Deal not found" })
          return
        }

        // Create and save the message
        const newMessage = new Message({
          deal: dealId,
          sender: socket.user._id,
          content: message,
          read: false,
        })

        await newMessage.save()

        // Populate sender info
        await newMessage.populate("sender", "name email role")

        // Emit the message to all users in the deal room
        io.to(`deal:${dealId}`).emit("new_message", newMessage)

        // Create notification for the other participant
        const recipientId = deal.buyer.toString() === socket.user._id.toString() ? deal.seller : deal.buyer

        if (recipientId) {
          const notification = new Notification({
            user: recipientId,
            type: "message",
            content: `New message from ${socket.user.name} in deal "${deal.title}"`,
            dealId: deal._id,
            read: false,
          })

          await notification.save()

          // Emit notification to the recipient
          io.to(`user:${recipientId}`).emit("new_notification", notification)
        }

        // Cache the message in Redis if available
        if (redisClient) {
          const messageData = {
            _id: newMessage._id.toString(),
            deal: dealId,
            sender: {
              _id: socket.user._id.toString(),
              name: socket.user.name,
              role: socket.user.role,
            },
            content: message,
            read: false,
            createdAt: newMessage.createdAt,
          }

          // Add to the deal's messages list (limited to last 50 messages)
          await redisClient.lpush(`deal:${dealId}:messages`, JSON.stringify(messageData))
          await redisClient.ltrim(`deal:${dealId}:messages`, 0, 49)

          // Set expiry (24 hours)
          await redisClient.expire(`deal:${dealId}:messages`, 60 * 60 * 24)
        }
      } catch (error) {
        console.error("Error sending message:", error)
        socket.emit("error", { message: "Error sending message" })
      }
    })

    // Handle typing indicators
    socket.on("typing_start", async ({ dealId }) => {
      // Emit to all users in the deal room except the sender
      socket.to(`deal:${dealId}`).emit("user_typing", { user: socket.user })
    })

    socket.on("typing_stop", async ({ dealId }) => {
      socket.to(`deal:${dealId}`).emit("user_stop_typing")
    })

    // Handle marking messages as read
    socket.on("mark_read", async ({ messageId }) => {
      try {
        const message = await Message.findById(messageId)

        if (!message) {
          return
        }

        message.read = true
        await message.save()

        // Emit to all users in the deal room
        io.to(`deal:${message.deal}`).emit("message_read", { messageId })
      } catch (error) {
        console.error("Error marking message as read:", error)
      }
    })

    // Handle price updates
    socket.on("update_price", async ({ dealId, price }) => {
      try {
        const deal = await Deal.findById(dealId)
          .populate("buyer", "name email role")
          .populate("seller", "name email role")

        if (!deal) {
          socket.emit("error", { message: "Deal not found" })
          return
        }

        // Update the deal price
        deal.price = price
        deal.priceHistory.unshift({
          price,
          user: socket.user._id,
          timestamp: new Date(),
        })

        await deal.save()

        // Create price update object with user info
        const priceUpdate = {
          price,
          user: {
            _id: socket.user._id,
            name: socket.user.name,
            role: socket.user.role,
          },
          timestamp: new Date(),
        }

        // Emit to all users in the deal room
        io.to(`deal:${dealId}`).emit("price_updated", { deal, priceUpdate })

        // Create notification for the other participant
        const recipientId = deal.buyer._id.toString() === socket.user._id.toString() ? deal.seller?._id : deal.buyer._id

        if (recipientId) {
          const notification = new Notification({
            user: recipientId,
            type: "price",
            content: `${socket.user.name} updated the price to $${price} in deal "${deal.title}"`,
            dealId: deal._id,
            read: false,
          })

          await notification.save()

          // Emit notification to the recipient
          io.to(`user:${recipientId}`).emit("new_notification", notification)
        }

        // Update deal in Redis cache if available
        if (redisClient) {
          const dealData = {
            _id: deal._id.toString(),
            title: deal.title,
            price: deal.price,
            status: deal.status,
            buyer: {
              _id: deal.buyer._id.toString(),
              name: deal.buyer.name,
              role: deal.buyer.role,
            },
            seller: deal.seller
              ? {
                  _id: deal.seller._id.toString(),
                  name: deal.seller.name,
                  role: deal.seller.role,
                }
              : null,
          }

          await redisClient.set(`deal:${dealId}`, JSON.stringify(dealData))
          await redisClient.expire(`deal:${dealId}`, 60 * 60 * 24) // 24 hours
        }
      } catch (error) {
        console.error("Error updating price:", error)
        socket.emit("error", { message: "Error updating price" })
      }
    })

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.user.name} (${socket.user._id})`)
    })
  })
}

