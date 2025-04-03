const jwt = require("jsonwebtoken")
const User = require("../models/User")

// Protect routes
exports.protect = async (req, res, next) => {
  let token

  // Check if auth header exists and starts with Bearer
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    // Set token from Bearer token
    token = req.headers.authorization.split(" ")[1]
  }

  // Check if token exists
  if (!token) {
    return res.status(401).json({ message: "Not authorized to access this route" })
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Get user from the token
    req.user = await User.findById(decoded.id).select("-password")

    if (!req.user) {
      return res.status(401).json({ message: "Not authorized to access this route" })
    }

    // Add isAdmin flag to request if present in token
    if (decoded.isAdmin) {
      req.isAdmin = true
    }

    next()
  } catch (err) {
    return res.status(401).json({ message: "Not authorized to access this route" })
  }
}

// Grant access to specific roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `User role ${req.user.role} is not authorized to access this route`,
      })
    }
    next()
  }
}

// Admin only middleware
exports.adminOnly = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      message: "Admin access required",
    })
  }
  next()
}

