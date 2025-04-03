const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Please provide a name"],
    trim: true,
    maxlength: [50, "Name cannot be more than 50 characters"],
  },
  email: {
    type: String,
    required: [true, "Please provide an email"],
    unique: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, "Please provide a valid email"],
  },
  password: {
    type: String,
    required: [true, "Please provide a password"],
    minlength: [6, "Password must be at least 6 characters"],
    select: false,
  },
  role: {
    type: String,
    enum: ["buyer", "seller", "admin"],
    default: "buyer",
  },
  status: {
    type: String,
    enum: ["active", "suspended"],
    default: "active",
  },
  profileImage: {
    type: String,
    default: "https://example.com/default-avatar.png",
  },
  bio: {
    type: String,
    maxlength: [500, "Bio cannot be more than 500 characters"],
  },
  location: {
    type: String,
    trim: true,
  },
  contactPhone: {
    type: String,
    trim: true,
    match: [/^\+?[1-9]\d{1,14}$/, "Please provide a valid phone number"],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastActive: {
    type: Date,
    default: Date.now,
  },
});

// Encrypt password using bcrypt
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Match user entered password to hashed password in database
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Update lastActive before saving
UserSchema.pre("save", function (next) {
  this.lastActive = Date.now();
  next();
});

module.exports = mongoose.model("User", UserSchema);
