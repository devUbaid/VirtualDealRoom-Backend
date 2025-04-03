const express = require("express")
const router = express.Router()
const jwt = require("jsonwebtoken")
const User = require("../models/User")
const { protect } = require("../middleware/auth")

// @route   POST /api/auth/register
// @desc    Register a user
// @access  Public
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body

    // Check if user already exists
    let user = await User.findOne({ email })

    if (user) {
      return res.status(400).json({ message: "User already exists" })
    }

    // Create user - only allow buyer or seller roles through registration
    user = new User({
      name,
      email,
      password,
      role: role === "seller" ? "seller" : "buyer", // Restrict to buyer or seller only
    })

    await user.save()

    // Create token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "30d" })

    res.status(201).json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   POST /api/auth/login
// @desc    Login user & get token
// @access  Public
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body

    // Check for user
    const user = await User.findOne({ email }).select("+password")

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" })
    }

    // Prevent admin login through regular login
    if (user.role === "admin") {
      return res.status(401).json({ message: "Invalid credentials" })
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password)

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" })
    }

    // Create token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "30d" })

    res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   POST /api/auth/admin-login
// @desc    Admin login & get token
// @access  Public
router.post("/admin-login", async (req, res) => {
  try {
    const { email, password } = req.body

    // Check for user
    const user = await User.findOne({ email }).select("+password")

    if (!user) {
      return res.status(401).json({ message: "Invalid admin credentials" })
    }

    // Ensure user is an admin
    if (user.role !== "admin") {
      return res.status(401).json({ message: "Not authorized as admin" })
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password)

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid admin credentials" })
    }

    // Create token with admin flag
    const token = jwt.sign(
      {
        id: user._id,
        isAdmin: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    )

    res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get("/me", protect, async (req, res) => {
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
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

module.exports = router

