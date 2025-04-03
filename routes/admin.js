const express = require("express")
const router = express.Router()
const mongoose = require("mongoose")
const User = require("../models/User")
const Deal = require("../models/Deal")
const Message = require("../models/Message")
const Document = require("../models/Document")
const { protect, authorize } = require("../middleware/auth")
const path = require("path")
const fs = require("fs")
const Notification = require("../models/Notification")

// @route   GET /api/admin/stats
// @desc    Get admin dashboard stats
// @access  Private/Admin
router.get("/stats", protect, authorize("admin"), async (req, res) => {
  try {
    // Get counts
    const totalDeals = await Deal.countDocuments()
    const activeDeals = await Deal.countDocuments({
      status: { $in: ["pending", "in-progress"] },
    })
    const completedDeals = await Deal.countDocuments({ status: "completed" })
    const cancelledDeals = await Deal.countDocuments({ status: "cancelled" })

    const totalUsers = await User.countDocuments()
    const buyers = await User.countDocuments({ role: "buyer" })
    const sellers = await User.countDocuments({ role: "seller" })

    res.json({
      totalDeals,
      activeDeals,
      completedDeals,
      cancelledDeals,
      totalUsers,
      buyers,
      sellers,
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   GET /api/admin/deals-by-status
// @desc    Get deals grouped by status for pie chart
// @access  Private/Admin
router.get("/deals-by-status", protect, authorize("admin"), async (req, res) => {
  try {
    const dealsByStatus = await Deal.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          name: "$_id",
          value: "$count",
        },
      },
    ])

    res.json(dealsByStatus)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   GET /api/admin/deals-over-time
// @desc    Get deals created over time for line chart
// @access  Private/Admin
router.get("/deals-over-time", protect, authorize("admin"), async (req, res) => {
  try {
    // Get deals created in the last 30 days
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const deals = await Deal.find({
      createdAt: { $gte: thirtyDaysAgo },
    }).sort({ createdAt: 1 })

    // Group deals by date
    const dealsOverTime = []
    const dateMap = {}

    deals.forEach((deal) => {
      const date = deal.createdAt.toISOString().split("T")[0]

      if (!dateMap[date]) {
        dateMap[date] = 0
      }

      dateMap[date]++
    })

    // Convert to array for chart
    for (const [date, count] of Object.entries(dateMap)) {
      dealsOverTime.push({ date, count })
    }

    res.json(dealsOverTime)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   GET /api/admin/user-activity
// @desc    Get user activity for bar chart
// @access  Private/Admin
router.get("/user-activity", protect, authorize("admin"), async (req, res) => {
  try {
    // Get top 10 users by activity
    const users = await User.find().limit(10)

    const userActivity = []

    for (const user of users) {
      const deals = await Deal.countDocuments({
        $or: [{ buyer: user._id }, { seller: user._id }],
      })

      const messages = await Message.countDocuments({ sender: user._id })

      const documents = await Document.countDocuments({ uploadedBy: user._id })

      userActivity.push({
        name: user.name,
        deals,
        messages,
        documents,
      })
    }

    // Sort by total activity
    userActivity.sort((a, b) => {
      const totalA = a.deals + a.messages + a.documents
      const totalB = b.deals + b.messages + b.documents
      return totalB - totalA
    })

    res.json(userActivity.slice(0, 10))
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   GET /api/admin/users
// @desc    Get all users
// @access  Private/Admin
router.get("/users", protect, authorize("admin"), async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 })

    // Add activity data to each user
    const usersWithActivity = await Promise.all(
      users.map(async (user) => {
        const dealCount = await Deal.countDocuments({
          $or: [{ buyer: user._id }, { seller: user._id }],
        })

        const messageCount = await Message.countDocuments({ sender: user._id })

        return {
          ...user.toObject(),
          dealCount,
          messageCount,
          status: user.status || "active", // Default status if not set
        }
      }),
    )

    res.json(usersWithActivity)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   PUT /api/admin/users/:id/status
// @desc    Update user status (active/suspended)
// @access  Private/Admin
router.put("/users/:id/status", protect, authorize("admin"), async (req, res) => {
  try {
    const { status } = req.body

    if (!["active", "suspended"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" })
    }

    const user = await User.findById(req.params.id)

    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    // Don't allow admins to suspend other admins
    if (user.role === "admin" && status === "suspended") {
      return res.status(403).json({ message: "Cannot suspend admin users" })
    }

    user.status = status
    await user.save()

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   GET /api/admin/deals
// @desc    Get all deals
// @access  Private/Admin
router.get("/deals", protect, authorize("admin"), async (req, res) => {
  try {
    const deals = await Deal.find()
      .populate("buyer", "name email")
      .populate("seller", "name email")
      .sort({ updatedAt: -1 })

    res.json(deals)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   DELETE /api/admin/deals/:id
// @desc    Delete a deal
// @access  Private/Admin
router.delete("/deals/:id", protect, authorize("admin"), async (req, res) => {
  try {
    const deal = await Deal.findById(req.params.id)

    if (!deal) {
      return res.status(404).json({ message: "Deal not found" })
    }

    // Delete all messages related to the deal
    await Message.deleteMany({ deal: deal._id })

    // Delete all documents related to the deal
    const documents = await Document.find({ deal: deal._id })

    for (const doc of documents) {
      // Delete file from filesystem
      const filePath = path.join(__dirname, "../uploads", doc.fileName)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }

      // Delete document record
      await Document.findByIdAndDelete(doc._id)
    }

    // Delete notifications related to the deal
    await Notification.deleteMany({ dealId: deal._id })

    // Delete the deal
    await Deal.findByIdAndDelete(req.params.id)

    res.json({ message: "Deal deleted successfully" })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

module.exports = router

