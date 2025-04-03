const express = require("express")
const router = express.Router()
const mongoose = require("mongoose")
const Listing = require("../models/Listing")
const User = require("../models/User")
const { protect, authorize } = require("../middleware/auth")
const multer = require("multer")
const path = require("path")
const fs = require("fs")
const { v4: uuidv4 } = require("uuid")

// Set up multer storage for listing images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../uploads/listings")

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
  // Allow only image files
  const allowedFileTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"]

  if (allowedFileTypes.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error("Only JPG, PNG and WebP images are allowed"), false)
  }
}

// Set up multer upload
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
})

// @route   GET /api/listings
// @desc    Get all listings
// @access  Public
router.get("/", async (req, res) => {
  try {
    const { category, minPrice, maxPrice, search, sort, limit = 10, page = 1 } = req.query

    // Build query
    const query = { status: "active" }

    if (category) {
      query.category = category
    }

    if (minPrice && maxPrice) {
      query.price = { $gte: minPrice, $lte: maxPrice }
    } else if (minPrice) {
      query.price = { $gte: minPrice }
    } else if (maxPrice) {
      query.price = { $lte: maxPrice }
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
      ]
    }

    // Build sort
    let sortOptions = { createdAt: -1 } // Default sort by newest

    if (sort === "price-asc") {
      sortOptions = { price: 1 }
    } else if (sort === "price-desc") {
      sortOptions = { price: -1 }
    } else if (sort === "popular") {
      sortOptions = { views: -1 }
    }

    // Pagination
    const skip = (Number.parseInt(page) - 1) * Number.parseInt(limit)

    const listings = await Listing.find(query)
      .populate("seller", "name email profileImage")
      .sort(sortOptions)
      .limit(Number.parseInt(limit))
      .skip(skip)

    // Get total count for pagination
    const total = await Listing.countDocuments(query)

    res.json({
      listings,
      pagination: {
        total,
        page: Number.parseInt(page),
        pages: Math.ceil(total / Number.parseInt(limit)),
      },
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   GET /api/listings/:id
// @desc    Get listing by ID
// @access  Public
router.get("/:id", async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id).populate("seller", "name email profileImage bio location")

    if (!listing) {
      return res.status(404).json({ message: "Listing not found" })
    }

    // Increment view count
    listing.views += 1
    await listing.save()

    res.json(listing)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   POST /api/listings
// @desc    Create a new listing
// @access  Private/Seller
router.post("/", protect, authorize("seller"), upload.array("images", 5), async (req, res) => {
  try {
    const { title, description, price, category, features, tags, location } = req.body

    // Check if user is suspended
    const user = await User.findById(req.user.id)
    if (user.status === "suspended") {
      // Remove uploaded files if user is suspended
      if (req.files) {
        req.files.forEach((file) => {
          fs.unlinkSync(file.path)
        })
      }
      return res.status(403).json({ message: "Your account is suspended. You cannot create listings." })
    }

    // Process uploaded images
    const images = []
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => {
        images.push({
          url: `/uploads/listings/${file.filename}`,
          filename: file.filename,
        })
      })
    }

    // Create listing
    const listing = new Listing({
      title,
      description,
      price: Number.parseFloat(price),
      category,
      images,
      seller: req.user.id,
      features: features ? features.split(",").map((feature) => feature.trim()) : [],
      tags: tags ? tags.split(",").map((tag) => tag.trim()) : [],
      location,
    })

    await listing.save()

    res.status(201).json(listing)
  } catch (err) {
    console.error(err.message)

    // Remove uploaded files if there's an error
    if (req.files) {
      req.files.forEach((file) => {
        fs.unlinkSync(file.path)
      })
    }

    res.status(500).json({ message: "Server Error" })
  }
})

// @route   PUT /api/listings/:id
// @desc    Update a listing
// @access  Private/Seller
router.put("/:id", protect, authorize("seller"), upload.array("images", 5), async (req, res) => {
  try {
    const { title, description, price, category, features, tags, location, status } = req.body

    let listing = await Listing.findById(req.params.id)

    if (!listing) {
      // Remove uploaded files if listing not found
      if (req.files) {
        req.files.forEach((file) => {
          fs.unlinkSync(file.path)
        })
      }
      return res.status(404).json({ message: "Listing not found" })
    }

    // Check if user is the owner of the listing
    if (listing.seller.toString() !== req.user.id && req.user.role !== "admin") {
      // Remove uploaded files if not authorized
      if (req.files) {
        req.files.forEach((file) => {
          fs.unlinkSync(file.path)
        })
      }
      return res.status(403).json({ message: "Not authorized to update this listing" })
    }

    // Process uploaded images
    const newImages = []
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => {
        newImages.push({
          url: `/uploads/listings/${file.filename}`,
          filename: file.filename,
        })
      })
    }

    // Update listing
    const updatedListing = {
      title: title || listing.title,
      description: description || listing.description,
      price: price ? Number.parseFloat(price) : listing.price,
      category: category || listing.category,
      features: features ? features.split(",").map((feature) => feature.trim()) : listing.features,
      tags: tags ? tags.split(",").map((tag) => tag.trim()) : listing.tags,
      location: location || listing.location,
      status: status || listing.status,
    }

    // Only update images if new ones are uploaded
    if (newImages.length > 0) {
      // Delete old images from filesystem
      listing.images.forEach((image) => {
        const filePath = path.join(__dirname, "..", "uploads", "listings", image.filename)
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
      })

      updatedListing.images = newImages
    }

    listing = await Listing.findByIdAndUpdate(req.params.id, updatedListing, { new: true })

    res.json(listing)
  } catch (err) {
    console.error(err.message)

    // Remove uploaded files if there's an error
    if (req.files) {
      req.files.forEach((file) => {
        fs.unlinkSync(file.path)
      })
    }

    res.status(500).json({ message: "Server Error" })
  }
})

// @route   DELETE /api/listings/:id
// @desc    Delete a listing
// @access  Private/Seller or Admin
router.delete("/:id", protect, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id)

    if (!listing) {
      return res.status(404).json({ message: "Listing not found" })
    }

    // Check if user is the owner of the listing or an admin
    if (listing.seller.toString() !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized to delete this listing" })
    }

    // Delete images from filesystem
    listing.images.forEach((image) => {
      const filePath = path.join(__dirname, "..", "uploads", "listings", image.filename)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    })

    await Listing.findByIdAndDelete(req.params.id)

    res.json({ message: "Listing removed" })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   GET /api/listings/seller/:sellerId
// @desc    Get listings by seller
// @access  Public
router.get("/seller/:sellerId", async (req, res) => {
  try {
    const listings = await Listing.find({
      seller: req.params.sellerId,
      status: "active",
    }).sort({ createdAt: -1 })

    res.json(listings)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

// @route   GET /api/listings/categories
// @desc    Get all listing categories
// @access  Public
router.get("/categories/all", async (req, res) => {
  try {
    const categories = await Listing.distinct("category")
    res.json(categories)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ message: "Server Error" })
  }
})

module.exports = router

