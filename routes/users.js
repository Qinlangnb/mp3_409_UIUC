// Routes for /api/users
var User = require('../models/user');
var Task = require('../models/task');
var http = require('../lib/http');
var query = require('../lib/query');

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

// Validates the body of POST /api/users and PUT /api/users/:id.
// Returns { error: { status, message } } or the cleaned values.
function readUserBody(body) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return { error: { status: 400, message: 'Request body must be a JSON object' } };
    }
    if (!isNonEmptyString(body.name)) {
        return { error: { status: 400, message: 'A user needs a name' } };
    }
    if (!isNonEmptyString(body.email)) {
        return { error: { status: 400, message: 'A user needs an email' } };
    }

    var pendingTasks = [];
    if (body.pendingTasks !== undefined) {
        if (!Array.isArray(body.pendingTasks)) {
            return { error: { status: 400, message: 'pendingTasks must be an array of task ids' } };
        }
        for (var i = 0; i < body.pendingTasks.length; i++) {
            var id = body.pendingTasks[i];
            if (!query.isValidId(id)) {
                return { error: { status: 400, message: 'pendingTasks must contain valid task ids' } };
            }
            pendingTasks.push(String(id));
        }
    }

    return {
        value: {
            name: body.name,
            email: body.email,
            pendingTasks: pendingTasks
        }
    };
}

// Loads the tasks listed in pendingTasks and checks that they can be pending.
// Returns { error } or { tasks }.
async function loadPendingTasks(ids) {
    if (ids.length === 0) return { tasks: [] };

    var tasks = await Task.find({ _id: { $in: ids } });
    var found = {};
    tasks.forEach(function (task) {
        found[String(task._id)] = task;
    });

    var missing = [];
    var completed = [];
    ids.forEach(function (id) {
        var task = found[id];
        if (!task) {
            missing.push(id);
        } else if (task.completed) {
            completed.push(id);
        }
    });

    if (missing.length > 0) {
        return { error: { status: 404, message: 'No task exists with the id ' + missing[0] } };
    }
    if (completed.length > 0) {
        return { error: { status: 400, message: 'A completed task cannot be pending' } };
    }
    return { tasks: ids.map(function (id) { return found[id]; }) };
}

module.exports = function (router) {

    var usersRoute = router.route('/users');
    var userRoute = router.route('/users/:id');

    // GET /api/users
    usersRoute.get(async function (req, res) {
        var parsed = query.buildCollectionQuery(req.query, { defaultLimit: null });
        if (parsed.error) return http.badRequest(res, parsed.error);

        try {
            if (parsed.count) {
                var total = await User.countDocuments(parsed.filter);
                return http.ok(res, total);
            }

            var find = User.find(parsed.filter);
            if (parsed.sort) find = find.sort(parsed.sort);
            if (parsed.skip) find = find.skip(parsed.skip);
            if (parsed.limit !== null) find = find.limit(parsed.limit);
            if (parsed.projection) find = find.select(parsed.projection);

            var users = await find.exec();
            http.ok(res, users);
        } catch (err) {
            if (err.name === 'CastError') {
                return http.badRequest(res, 'A query value has the wrong format');
            }
            http.serverError(res);
        }
    });

    // POST /api/users
    usersRoute.post(async function (req, res) {
        var body = readUserBody(req.body);
        if (body.error) return http.badRequest(res, body.error.message);

        try {
            var existing = await User.findOne({ email: body.value.email });
            if (existing) {
                return http.badRequest(res, 'A user with this email already exists');
            }

            var pending = await loadPendingTasks(body.value.pendingTasks);
            if (pending.error) {
                return pending.error.status === 404
                    ? http.notFound(res, pending.error.message)
                    : http.badRequest(res, pending.error.message);
            }

            var user = new User({
                name: body.value.name,
                email: body.value.email,
                pendingTasks: body.value.pendingTasks
            });
            await user.save();

            // Every pending task that is new to this user becomes assigned to them
            if (body.value.pendingTasks.length > 0) {
                await Task.updateMany(
                    { _id: { $in: body.value.pendingTasks } },
                    { $set: { assignedUser: String(user._id), assignedUserName: user.name } }
                );
                // ... and must not stay in another user's pendingTasks
                await User.updateMany(
                    { _id: { $ne: user._id }, pendingTasks: { $in: body.value.pendingTasks } },
                    { $pull: { pendingTasks: { $in: body.value.pendingTasks } } }
                );
            }

            http.created(res, user);
        } catch (err) {
            http.serverError(res);
        }
    });

    // GET /api/users/:id
    userRoute.get(async function (req, res) {
        if (!query.isValidId(req.params.id)) {
            return http.notFound(res, 'User not found');
        }

        var select = null;
        if (req.query.select !== undefined) {
            var parsedSelect = query.parseSelect(req.query.select);
            if (parsedSelect.error) return http.badRequest(res, parsedSelect.error);
            select = parsedSelect.value;
        }

        try {
            var find = User.findById(req.params.id);
            if (select) find = find.select(select);
            var user = await find.exec();
            if (!user) return http.notFound(res, 'User not found');
            http.ok(res, user);
        } catch (err) {
            if (err.name === 'CastError') return http.notFound(res, 'User not found');
            http.serverError(res);
        }
    });

    // PUT /api/users/:id
    userRoute.put(async function (req, res) {
        if (!query.isValidId(req.params.id)) {
            return http.notFound(res, 'User not found');
        }

        var body = readUserBody(req.body);
        if (body.error) return http.badRequest(res, body.error.message);

        try {
            var user = await User.findById(req.params.id);
            if (!user) return http.notFound(res, 'User not found');

            var duplicate = await User.findOne({
                email: body.value.email,
                _id: { $ne: user._id }
            });
            if (duplicate) {
                return http.badRequest(res, 'A user with this email already exists');
            }

            var pending = await loadPendingTasks(body.value.pendingTasks);
            if (pending.error) {
                return pending.error.status === 404
                    ? http.notFound(res, pending.error.message)
                    : http.badRequest(res, pending.error.message);
            }

            var userId = String(user._id);
            var oldPending = (user.pendingTasks || []).map(String);
            var newPending = body.value.pendingTasks;

            var removed = oldPending.filter(function (id) { return newPending.indexOf(id) === -1; });
            var added = newPending.filter(function (id) { return oldPending.indexOf(id) === -1; });

            // Tasks that are currently assigned to somebody else move to this user
            var previousOwners = [];
            pending.tasks.forEach(function (task) {
                if (task.assignedUser && task.assignedUser !== userId) {
                    previousOwners.push(task.assignedUser);
                }
            });

            if (removed.length > 0) {
                await Task.updateMany(
                    { _id: { $in: removed } },
                    { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
                );
            }

            if (added.length > 0) {
                await Task.updateMany(
                    { _id: { $in: added } },
                    { $set: { assignedUser: userId, assignedUserName: body.value.name } }
                );
            }

            if (previousOwners.length > 0) {
                await User.updateMany(
                    { _id: { $in: previousOwners }, pendingTasks: { $in: newPending } },
                    { $pull: { pendingTasks: { $in: newPending } } }
                );
            }

            // A renamed user is reflected on every task assigned to them, completed or not
            if (user.name !== body.value.name) {
                await Task.updateMany(
                    { assignedUser: userId },
                    { $set: { assignedUserName: body.value.name } }
                );
            }

            user.name = body.value.name;
            user.email = body.value.email;
            user.pendingTasks = newPending;
            await user.save();

            http.ok(res, user);
        } catch (err) {
            http.serverError(res);
        }
    });

    // DELETE /api/users/:id
    userRoute.delete(async function (req, res) {
        if (!query.isValidId(req.params.id)) {
            return http.notFound(res, 'User not found');
        }

        try {
            var user = await User.findById(req.params.id);
            if (!user) return http.notFound(res, 'User not found');

            // Deleting a user unassigns all of their tasks, completed ones included
            await Task.updateMany(
                { assignedUser: String(user._id) },
                { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
            );

            await user.deleteOne();
            http.noContent(res);
        } catch (err) {
            http.serverError(res);
        }
    });

    return router;
};
