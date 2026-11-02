// Load required packages
var mongoose = require('mongoose');

// Define our task schema
var TaskSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, default: '' },
    deadline: { type: Date, required: true },
    completed: { type: Boolean, default: false },
    // _id of the assigned user, "" when the task is unassigned
    assignedUser: { type: String, default: '' },
    // name of the assigned user, "unassigned" when nobody is assigned
    assignedUserName: { type: String, default: 'unassigned' },
    // Set by the server when the document is created; never changed afterwards
    dateCreated: { type: Date, default: Date.now }
});

// Export the Mongoose model
module.exports = mongoose.model('Task', TaskSchema);
