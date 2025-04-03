const express = require("express")
const router = express.Router()
const User = require("../models/User")
const { protect } = require("../middleware/auth")

// @route   GET /api/users/profile
// @desc    Get user profile
// @access  Private
router.get("/profile", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)

    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   PUT /api/users/profile
// @desc    Update user profile
// @access  Private
router.put("/profile", protect, async (req, res) => {
  try {
    const { name, email } = req.body

    // Build user object
    const userFields = {}
    if (name) userFields.name = name
    if (email) userFields.email = email

    // Update user
    let user = await User.findById(req.user.id)

    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    // Check if email is already taken
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email })
      if (existingUser) {
        return res.status(400).json({ message: "Email already in use" })
      }
    }

    user = await User.findByIdAndUpdate(req.user.id, { $set: userFields }, { new: true })

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   PUT /api/users/password
// @desc    Update user password
// @access  Private
router.put("/password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body

    // Check if passwords are provided
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Please provide both current and new password" })
    }

    // Check if new password meets requirements
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" })
    }

    // Get user with password
    const user = await User.findById(req.user.id).select("+password")

    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    // Check if current password is correct
    const isMatch = await user.matchPassword(currentPassword)

    if (!isMatch) {
      return res.status(401).json({ message: "Current password is incorrect" })
    }

    // Update password
    user.password = newPassword
    await user.save()

    res.json({ message: "Password updated successfully" })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

module.exports = router

