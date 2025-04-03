const express = require("express")
const router = express.Router()
const mongoose = require("mongoose")
const Deal = require("../models/Deal")
const Message = require("../models/Message")
const Document = require("../models/Document")
const Notification = require("../models/Notification")
const { protect, authorize } = require("../middleware/auth")
const multer = require("multer")
const path = require("path")
const fs = require("fs")
const { v4: uuidv4 } = require("uuid")

// Set up multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../uploads")

    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }

    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueFilename = `${uuidv4()}${path.extname(file.originalname)}`
    cb(null, uniqueFilename)
  },
})

// File filter
const fileFilter = (req, file, cb) => {
  // Allow only PDF, DOCX, and PNG files
  const allowedFileTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/png",
  ]

  if (allowedFileTypes.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error("Only PDF, DOCX, and PNG files are allowed"), false)
  }
}

// Set up multer upload
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
})

// @route   GET /api/deals
// @desc    Get all deals for the current user
// @access  Private
router.get("/", protect, async (req, res) => {
  try {
    const query = {}

    // Filter deals based on user role
    if (req.user.role === "buyer") {
      query.buyer = req.user.id
    } else if (req.user.role === "seller") {
      query.$or = [{ seller: req.user.id }, { seller: null }]
    } else if (req.user.role === "admin") {
      // Admin can see all deals
    } else {
      return res.status(403).json({ message: "Not authorized" })
    }

    const deals = await Deal.find(query)
      .populate("buyer", "name email")
      .populate("seller", "name email")
      .sort({ updatedAt: -1 })

    res.json(deals)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// Add this route to get available deals for sellers
// @route   GET /api/deals/available
// @desc    Get all available deals for sellers (pending deals without a seller)
// @access  Private/Seller
router.get("/available", protect, authorize("seller"), async (req, res) => {
  try {
    const deals = await Deal.find({
      status: "pending",
      seller: null, // Only deals without a seller assigned
    })
      .populate("buyer", "name email")
      .sort({ createdAt: -1 })

    res.json(deals)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// Add these routes to support seller-initiated deals and buyer browsing

// @route   POST /api/deals/from-listing
// @desc    Create a deal from a listing (buyer initiated)
// @access  Private/Buyer
router.post("/from-listing", protect, authorize("buyer"), async (req, res) => {
  try {
    const { listingId, price, message } = req.body

    // Find the listing
    const listing = await mongoose.model("Listing").findById(listingId)

    if (!listing) {
      return res.status(404).json({ message: "Listing not found" })
    }

    if (listing.status !== "active") {
      return res.status(400).json({ message: "This listing is no longer active" })
    }

    // Create deal
    const deal = new Deal({
      title: listing.title,
      description: listing.description,
      price: price || listing.price,
      buyer: req.user.id,
      seller: listing.seller,
      listing: listing._id,
      initiatedBy: "buyer",
      priceHistory: [
        {
          price: price || listing.price,
          user: req.user.id,
          timestamp: Date.now(),
        },
      ],
    })

    await deal.save()

    // Populate user info
    await deal.populate("buyer", "name email")
    await deal.populate("seller", "name email")

    // Create notification for the seller
    const notification = new Notification({
      user: listing.seller,
      type: "deal",
      content: `New deal request for "${listing.title}" from ${req.user.name}`,
      dealId: deal._id,
      read: false,
    })

    await notification.save()

    // Emit notification to the seller
    req.app.get("io").to(`user:${listing.seller}`).emit("new_notification", notification)

    // If initial message was provided, create it
    if (message) {
      const newMessage = new Message({
        deal: deal._id,
        sender: req.user.id,
        content: message,
        read: false,
      })

      await newMessage.save()
      await newMessage.populate("sender", "name email role")

      // Emit the message to the seller
      req.app.get("io").to(`user:${listing.seller}`).emit("new_message", newMessage)
    }

    res.status(201).json(deal)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   GET /api/deals/my-listings
// @desc    Get deals related to seller's listings
// @access  Private/Seller
router.get("/my-listings", protect, authorize("seller"), async (req, res) => {
  try {
    const deals = await Deal.find({ seller: req.user.id })
      .populate("buyer", "name email")
      .populate("listing", "title images")
      .sort({ updatedAt: -1 })

    res.json(deals)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   POST /api/deals
// @desc    Create a new deal
// @access  Private
router.post("/", protect, async (req, res) => {
  try {
    const { title, description, price } = req.body

    // Create deal
    const deal = new Deal({
      title,
      description,
      price,
      buyer: req.user.id,
      priceHistory: [
        {
          price,
          user: req.user.id,
          timestamp: Date.now(),
        },
      ],
    })

    await deal.save()

    // Populate buyer info
    await deal.populate("buyer", "name email")

    // Create notification for sellers
    if (req.user.role === "buyer") {
      const sellers = await mongoose.model("User").find({ role: "seller" })

      for (const seller of sellers) {
        const notification = new Notification({
          user: seller._id,
          type: "deal",
          content: `New deal "${title}" created by ${req.user.name}`,
          dealId: deal._id,
          read: false,
        })

        await notification.save()

        // Emit notification to the seller
        req.app.get("io").to(`user:${seller._id}`).emit("new_notification", notification)
      }
    }

    res.status(201).json(deal)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   GET /api/deals/:id
// @desc    Get a deal by ID
// @access  Private
router.get("/:id", protect, async (req, res) => {
  try {
    const deal = await Deal.findById(req.params.id)
      .populate("buyer", "name email role")
      .populate("seller", "name email role")

    if (!deal) {
      return res.status(404).json({ message: "Deal not found" })
    }

    // Check if user is authorized to view the deal
    const isAuthorized =
      deal.buyer._id.toString() === req.user.id ||
      (deal.seller && deal.seller._id.toString() === req.user.id) ||
      req.user.role === "admin"

    if (!isAuthorized) {
      return res.status(403).json({ message: "Not authorized to view this deal" })
    }

    res.json(deal)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   PUT /api/deals/:id
// @desc    Update a deal
// @access  Private
router.put("/:id", protect, async (req, res) => {
  try {
    const { title, description } = req.body

    const deal = await Deal.findById(req.params.id)

    if (!deal) {
      return res.status(404).json({ message: "Deal not found" })
    }

    // Check if user is authorized to update the deal
    const isAuthorized =
      deal.buyer.toString() === req.user.id ||
      (deal.seller && deal.seller.toString() === req.user.id) ||
      req.user.role === "admin"

    if (!isAuthorized) {
      return res.status(403).json({ message: "Not authorized to update this deal" })
    }

    // Check if deal can be updated
    if (deal.status === "completed" || deal.status === "cancelled") {
      return res.status(400).json({ message: "Cannot update a completed or cancelled deal" })
    }

    // Update deal
    if (title) deal.title = title
    if (description) deal.description = description

    await deal.save()

    // Populate user info
    await deal.populate("buyer", "name email role")
    await deal.populate("seller", "name email role")

    res.json(deal)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   PUT /api/deals/:id/status
// @desc    Update deal status
// @access  Private
router.put("/:id/status", protect, async (req, res) => {
  try {
    const { status } = req.body

    if (!["pending", "in-progress", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" })
    }

    const deal = await Deal.findById(req.params.id)
      .populate("buyer", "name email role")
      .populate("seller", "name email role")

    if (!deal) {
      return res.status(404).json({ message: "Deal not found" })
    }

    // Check if user is authorized to update the deal status
    const isAuthorized =
      deal.buyer._id.toString() === req.user.id ||
      (deal.seller && deal.seller._id.toString() === req.user.id) ||
      req.user.role === "admin"

    if (!isAuthorized) {
      return res.status(403).json({ message: "Not authorized to update this deal" })
    }

    // Additional authorization checks based on status
    if (status === "in-progress" && req.user.role !== "seller" && req.user.role !== "admin") {
      return res.status(403).json({ message: "Only sellers can accept deals" })
    }

    // If a seller is accepting a deal, assign them as the seller
    if (status === "in-progress" && req.user.role === "seller" && !deal.seller) {
      deal.seller = req.user.id
    }

    // Update status
    deal.status = status
    await deal.save()

    // Create notification for the other participant
    const otherParticipantId = deal.buyer._id.toString() === req.user.id ? deal.seller?._id : deal.buyer._id

    if (otherParticipantId) {
      const statusText = {
        pending: "set to pending",
        "in-progress": "accepted",
        completed: "marked as completed",
        cancelled: "cancelled",
      }[status]

      const notification = new Notification({
        user: otherParticipantId,
        type: "status",
        content: `Deal "${deal.title}" was ${statusText} by ${req.user.name}`,
        dealId: deal._id,
        read: false,
      })

      await notification.save()

      // Emit notification to the other participant
      req.app.get("io").to(`user:${otherParticipantId}`).emit("new_notification", notification)
    }

    // Emit deal status update to all users in the deal room
    req.app.get("io").to(`deal:${deal._id}`).emit("deal_status_updated", deal)

    res.json(deal)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   GET /api/deals/:id/messages
// @desc    Get messages for a deal
// @access  Private
router.get("/:id/messages", protect, async (req, res) => {
  try {
    const deal = await Deal.findById(req.params.id)

    if (!deal) {
      return res.status(404).json({ message: "Deal not found" })
    }

    // Check if user is authorized to view messages
    const isAuthorized =
      deal.buyer.toString() === req.user.id ||
      (deal.seller && deal.seller.toString() === req.user.id) ||
      req.user.role === "admin"

    if (!isAuthorized) {
      return res.status(403).json({ message: "Not authorized to view messages for this deal" })
    }

    // Try to get messages from Redis cache first
    let messages
    const redisClient = req.app.get("redisClient")

    if (redisClient) {
      const cachedMessages = await redisClient.lrange(`deal:${req.params.id}:messages`, 0, -1)

      if (cachedMessages && cachedMessages.length > 0) {
        messages = cachedMessages.map((msg) => JSON.parse(msg))
      } else {
        // If not in cache, get from database
        messages = await Message.find({ deal: req.params.id })
          .populate("sender", "name email role")
          .sort({ createdAt: 1 })

        // Cache messages in Redis
        for (const msg of messages) {
          const messageData = {
            _id: msg._id.toString(),
            deal: msg.deal.toString(),
            sender: {
              _id: msg.sender._id.toString(),
              name: msg.sender.name,
              role: msg.sender.role,
            },
            content: msg.content,
            read: msg.read,
            createdAt: msg.createdAt,
          }

          await redisClient.rpush(`deal:${req.params.id}:messages`, JSON.stringify(messageData))
        }

        // Set expiry (24 hours)
        await redisClient.expire(`deal:${req.params.id}:messages`, 60 * 60 * 24)
      }
    } else {
      // If Redis is not available, get from database
      messages = await Message.find({ deal: req.params.id })
        .populate("sender", "name email role")
        .sort({ createdAt: 1 })
    }

    res.json(messages)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   GET /api/deals/:id/price-history
// @desc    Get price history for a deal
// @access  Private
router.get("/:id/price-history", protect, async (req, res) => {
  try {
    const deal = await Deal.findById(req.params.id).populate("priceHistory.user", "name email role")

    if (!deal) {
      return res.status(404).json({ message: "Deal not found" })
    }

    // Check if user is authorized to view price history
    const isAuthorized =
      deal.buyer.toString() === req.user.id ||
      (deal.seller && deal.seller.toString() === req.user.id) ||
      req.user.role === "admin"

    if (!isAuthorized) {
      return res.status(403).json({ message: "Not authorized to view price history for this deal" })
    }

    res.json(deal.priceHistory)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   POST /api/deals/:id/documents
// @desc    Upload a document for a deal
// @access  Private
router.post("/:id/documents", protect, upload.single("document"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Please upload a file" })
    }

    const deal = await Deal.findById(req.params.id)

    if (!deal) {
      // Remove uploaded file if deal not found
      fs.unlinkSync(req.file.path)
      return res.status(404).json({ message: "Deal not found" })
    }

    // Check if user is authorized to upload documents
    const isAuthorized =
      deal.buyer.toString() === req.user.id ||
      (deal.seller && deal.seller.toString() === req.user.id) ||
      req.user.role === "admin"

    if (!isAuthorized) {
      // Remove uploaded file if not authorized
      fs.unlinkSync(req.file.path)
      return res.status(403).json({ message: "Not authorized to upload documents for this deal" })
    }

    // Create document record
    const document = new Document({
      deal: req.params.id,
      originalName: req.file.originalname,
      fileName: req.file.filename,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      uploadedBy: req.user.id,
      accessControl: req.body.accessControl || "all",
    })

    await document.save()

    // Populate user info
    await document.populate("uploadedBy", "name email role")

    // Create notification for the other participant
    const otherParticipantId = deal.buyer.toString() === req.user.id ? deal.seller : deal.buyer

    if (otherParticipantId) {
      const notification = new Notification({
        user: otherParticipantId,
        type: "document",
        content: `${req.user.name} uploaded a document "${req.file.originalname}" to deal "${deal.title}"`,
        dealId: deal._id,
        read: false,
      })

      await notification.save()

      // Emit notification to the other participant
      req.app.get("io").to(`user:${otherParticipantId}`).emit("new_notification", notification)
    }

    // Emit new document to all users in the deal room
    req.app.get("io").to(`deal:${deal._id}`).emit("new_document", document)

    res.status(201).json(document)
  } catch (err) {
    console.error(err.message)

    // Remove uploaded file if there's an error
    if (req.file) {
      fs.unlinkSync(req.file.path)
    }

    res.status(500).json({ message: "Server Error" })
  }
})

// @route   GET /api/deals/:id/documents
// @desc    Get documents for a deal
// @access  Private
router.get("/:id/documents", protect, async (req, res) => {
  try {
    const deal = await Deal.findById(req.params.id)

    if (!deal) {
      return res.status(404).json({ message: "Deal not found" })
    }

    // Check if user is authorized to view documents
    const isAuthorized =
      deal.buyer.toString() === req.user.id ||
      (deal.seller && deal.seller.toString() === req.user.id) ||
      req.user.role === "admin"

    if (!isAuthorized) {
      return res.status(403).json({ message: "Not authorized to view documents for this deal" })
    }

    const documents = await Document.find({ deal: req.params.id })
      .populate("uploadedBy", "name email role")
      .sort({ createdAt: -1 })

    res.json(documents)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   GET /api/deals/:dealId/documents/:documentId/download
// @desc    Download a document
// @access  Private
router.get("/:dealId/documents/:documentId/download", protect, async (req, res) => {
  try {
    const deal = await Deal.findById(req.params.dealId)

    if (!deal) {
      return res.status(404).json({ message: "Deal not found" })
    }

    const document = await Document.findById(req.params.documentId)

    if (!document) {
      return res.status(404).json({ message: "Document not found" })
    }

    // Check if user is authorized to download the document
    const isAuthorized =
      deal.buyer.toString() === req.user.id ||
      (deal.seller && deal.seller.toString() === req.user.id) ||
      req.user.role === "admin"

    if (!isAuthorized) {
      return res.status(403).json({ message: "Not authorized to download this document" })
    }

    // Check access control
    if (document.accessControl !== "all") {
      if (
        (document.accessControl === "buyer" &&
          req.user.role !== "buyer" &&
          document.uploadedBy.toString() !== req.user.id) ||
        (document.accessControl === "seller" &&
          req.user.role !== "seller" &&
          document.uploadedBy.toString() !== req.user.id)
      ) {
        return res.status(403).json({ message: "You do not have permission to access this document" })
      }
    }

    const filePath = path.join(__dirname, "../uploads", document.fileName)

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found" })
    }

    res.download(filePath, document.originalName)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   DELETE /api/deals/:dealId/documents/:documentId
// @desc    Delete a document
// @access  Private
router.delete("/:dealId/documents/:documentId", protect, async (req, res) => {
  try {
    const deal = await Deal.findById(req.params.dealId)

    if (!deal) {
      return res.status(404).json({ message: "Deal not found" })
    }

    const document = await Document.findById(req.params.documentId)

    if (!document) {
      return res.status(404).json({ message: "Document not found" })
    }

    // Check if user is authorized to delete the document
    const isAuthorized = document.uploadedBy.toString() === req.user.id || req.user.role === "admin"

    if (!isAuthorized) {
      return res.status(403).json({ message: "Not authorized to delete this document" })
    }

    // Delete file from filesystem
    const filePath = path.join(__dirname, "../uploads", document.fileName)

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // Delete document from database
    await Document.findByIdAndDelete(req.params.documentId)

    // Emit document deleted to all users in the deal room
    req.app.get("io").to(`deal:${deal._id}`).emit("document_deleted", { documentId: req.params.documentId })

    res.json({ message: "Document deleted" })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

module.exports = router

