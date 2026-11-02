// Get the packages we need
var express = require('express'),
    router = express.Router(),
    mongoose = require('mongoose');

// Read .env file
require('dotenv').config();

// Create our Express application
var app = express();

// Use environment defined port or 3000
var port = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI).catch(function (err) {
    console.error('MongoDB connection error:', err.message);
});

// Allow CORS so that backend and frontend could be put on different servers
var allowCrossDomain = function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS");
    next();
};
app.use(allowCrossDomain);

// Parse URL-encoded and JSON request bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Use routes as a module (see index.js)
require('./routes')(app, router);

// Anything that did not match a route is not found
app.use(function (req, res) {
    res.status(404).json({ message: 'Not Found', data: 'This endpoint does not exist' });
});

// Never expose internals, whatever went wrong
app.use(function (err, req, res, next) {
    if (err && err.status === 400) {
        return res.status(400).json({ message: 'Bad Request', data: 'The request could not be understood' });
    }
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', data: 'An unexpected error occurred.' });
});

// Start the server
app.listen(port);
console.log('Server running on port ' + port);
