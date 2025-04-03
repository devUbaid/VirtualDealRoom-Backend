const mongoose = require("mongoose")

const PriceHistorySchema = new mongoose.Schema({
  price: {
    type: Number,
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
})

const DealSchema = new mongoose.Schema({
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
  status: {
    type: String,
    enum: ["pending", "in-progress", "completed", "cancelled"],
    default: "pending",
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Listing",
  },
  initiatedBy: {
    type: String,
    enum: ["buyer", "seller"],
    required: true,
  },
  priceHistory: [PriceHistorySchema],
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
DealSchema.pre("save", function (next) {
  this.updatedAt = Date.now()
  next()
})

module.exports = mongoose.model("Deal", DealSchema)

