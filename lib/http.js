// Small helpers so every response has the same { message, data } shape.

function success(res, status, data) {
    res.status(status).json({ message: 'OK', data: data });
}

module.exports = {
    ok: function (res, data) {
        success(res, 200, data);
    },
    created: function (res, data) {
        success(res, 201, data);
    },
    noContent: function (res) {
        res.status(204).end();
    },
    badRequest: function (res, data) {
        res.status(400).json({ message: 'Bad Request', data: data });
    },
    notFound: function (res, data) {
        res.status(404).json({ message: 'Not Found', data: data });
    },
    serverError: function (res) {
        // Never leak Mongoose / MongoDB internals to the client
        res.status(500).json({
            message: 'Internal Server Error',
            data: 'An unexpected error occurred.'
        });
    }
};
