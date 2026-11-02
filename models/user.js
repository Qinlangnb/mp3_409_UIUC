// Load required packages
var mongoose = require('mongoose');

// Define our user schema
var UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    // Ids of this user's pending (not completed) tasks
    pendingTasks: { type: [String], default: [] },
    // Set by the server when the document is created; never changed afterwards
    dateCreated: { type: Date, default: Date.now }
});

// Export the Mongoose model
module.exports = mongoose.model('User', UserSchema);
