const mongoose = require("mongoose")

const NotificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  type: {
    type: String,
    enum: ["deal", "message", "price", "document", "status"],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  dealId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Deal",
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

module.exports = mongoose.model("Notification", NotificationSchema)

