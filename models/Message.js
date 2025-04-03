const mongoose = require("mongoose")

const MessageSchema = new mongoose.Schema({
  deal: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Deal",
    required: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  content: {
    type: String,
    required: [true, "Message content is required"],
    trim: true,
  },
  read: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
})

module.exports = mongoose.model("Message", MessageSchema)

