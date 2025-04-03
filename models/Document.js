const mongoose = require("mongoose")

const DocumentSchema = new mongoose.Schema({
  deal: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Deal",
    required: true,
  },
  originalName: {
    type: String,
    required: true,
  },
  fileName: {
    type: String,
    required: true,
  },
  fileType: {
    type: String,
    required: true,
  },
  fileSize: {
    type: Number,
    required: true,
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  accessControl: {
    type: String,
    enum: ["all", "buyer", "seller"],
    default: "all",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
})

module.exports = mongoose.model("Document", DocumentSchema)

