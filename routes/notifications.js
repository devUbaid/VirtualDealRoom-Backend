const express = require("express")
const router = express.Router()
const Notification = require("../models/Notification")
const { protect } = require("../middleware/auth")

// @route   GET /api/notifications
// @desc    Get all notifications for the current user
// @access  Private
router.get("/", protect, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(50)

    res.json(notifications)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   PUT /api/notifications/:id/read
// @desc    Mark a notification as read
// @access  Private
router.put("/:id/read", protect, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id)

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" })
    }

    // Check if notification belongs to the current user
    if (notification.user.toString() !== req.user.id) {
      return res.status(403).json({ message: "Not authorized" })
    }

    notification.read = true
    await notification.save()

    res.json(notification)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   PUT /api/notifications/read-all
// @desc    Mark all notifications as read
// @access  Private
router.put("/read-all", protect, async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user.id, read: false }, { $set: { read: true } })

    res.json({ message: "All notifications marked as read" })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   DELETE /api/notifications/:id
// @desc    Delete a notification
// @access  Private
router.delete("/:id", protect, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id)

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" })
    }

    // Check if notification belongs to the current user
    if (notification.user.toString() !== req.user.id) {
      return res.status(403).json({ message: "Not authorized" })
    }

    await Notification.findByIdAndDelete(req.params.id)

    res.json({ message: "Notification deleted" })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

module.exports = router

