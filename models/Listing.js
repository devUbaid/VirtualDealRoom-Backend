const mongoose = require("mongoose")

const ListingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, "Please provide a title"],
    trim: true,
    maxlength: [100, "Title cannot be more than 100 characters"],
  },
  description: {
    type: String,
    required: [true, "Please provide a description"],
    trim: true,
  },
  price: {
    type: Number,
    required: [true, "Please provide a price"],
  },
  category: {
    type: String,
    required: [true, "Please select a category"],
    trim: true,
  },
  images: [
    {
      url: {
        type: String,
        required: true,
      },
      filename: {
        type: String,
        required: true,
      },
    },
  ],
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  status: {
    type: String,
    enum: ["active", "pending", "sold", "inactive"],
    default: "active",
  },
  features: [String],
  tags: [String],
  location: {
    type: String,
    trim: true,
  },
  views: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
})

// Update the updatedAt field before saving
ListingSchema.pre("save", function (next) {
  this.updatedAt = Date.now()
  next()
})

module.exports = mongoose.model("Listing", ListingSchema)

