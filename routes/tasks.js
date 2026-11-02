// Routes for /api/tasks
var Task = require('../models/task');
var User = require('../models/user');
var http = require('../lib/http');
var query = require('../lib/query');

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

function parseDeadline(value) {
    if (value === undefined || value === null) {
        return { error: 'A task needs a deadline' };
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
        return { error: 'deadline must be a date' };
    }
    var date = new Date(value);
    if (isNaN(date.getTime())) {
        return { error: 'deadline must be a valid date' };
    }
    return { value: date };
}

// Validates the body of POST /api/tasks and PUT /api/tasks/:id.
async function readTaskBody(body) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return { error: { status: 400, message: 'Request body must be a JSON object' } };
    }
    if (!isNonEmptyString(body.name)) {
        return { error: { status: 400, message: 'A task needs a name' } };
    }

    var deadline = parseDeadline(body.deadline);
    if (deadline.error) {
        return { error: { status: 400, message: deadline.error } };
    }

    var description = '';
    if (body.description !== undefined) {
        if (typeof body.description !== 'string') {
            return { error: { status: 400, message: 'description must be a string' } };
        }
        description = body.description;
    }

    var completed = false;
    if (body.completed !== undefined) {
        if (typeof body.completed !== 'boolean') {
            return { error: { status: 400, message: 'completed must be true or false' } };
        }
        completed = body.completed;
    }

    var assignedUser = '';
    var assignedUserName = 'unassigned';
    var assignedUserDoc = null;

    if (body.assignedUser !== undefined && body.assignedUser !== '') {
        if (typeof body.assignedUser !== 'string' || !query.isValidId(body.assignedUser)) {
            return { error: { status: 400, message: 'assignedUser must be a valid user id' } };
        }
        assignedUserDoc = await User.findById(body.assignedUser);
        if (!assignedUserDoc) {
            return { error: { status: 404, message: 'No user exists with the id ' + body.assignedUser } };
        }
        assignedUser = String(assignedUserDoc._id);
        assignedUserName = assignedUserDoc.name;

        if (body.assignedUserName !== undefined) {
            if (typeof body.assignedUserName !== 'string') {
                return { error: { status: 400, message: 'assignedUserName must be a string' } };
            }
            if (body.assignedUserName !== assignedUserDoc.name) {
                return {
                    error: { status: 400, message: 'assignedUserName does not match assignedUser' }
                };
            }
        }
    }

    return {
        value: {
            name: body.name,
            description: description,
            deadline: deadline.value,
            completed: completed,
            assignedUser: assignedUser,
            assignedUserName: assignedUserName
        }
    };
}

module.exports = function (router) {

    var tasksRoute = router.route('/tasks');
    var taskRoute = router.route('/tasks/:id');

    // GET /api/tasks
    tasksRoute.get(async function (req, res) {
        var parsed = query.buildCollectionQuery(req.query, { defaultLimit: 100 });
        if (parsed.error) return http.badRequest(res, parsed.error);

        try {
            if (parsed.count) {
                var total = await Task.countDocuments(parsed.filter);
                return http.ok(res, total);
            }

            var find = Task.find(parsed.filter);
            if (parsed.sort) find = find.sort(parsed.sort);
            if (parsed.skip) find = find.skip(parsed.skip);
            if (parsed.limit !== null) find = find.limit(parsed.limit);
            if (parsed.projection) find = find.select(parsed.projection);

            var tasks = await find.exec();
            http.ok(res, tasks);
        } catch (err) {
            if (err.name === 'CastError') {
                return http.badRequest(res, 'A query value has the wrong format');
            }
            http.serverError(res);
        }
    });

    // POST /api/tasks
    tasksRoute.post(async function (req, res) {
        try {
            var body = await readTaskBody(req.body);
            if (body.error) {
                return body.error.status === 404
                    ? http.notFound(res, body.error.message)
                    : http.badRequest(res, body.error.message);
            }

            var task = new Task(body.value);
            await task.save();

            // A new pending task assigned to a user belongs in that user's pendingTasks
            if (task.assignedUser && !task.completed) {
                await User.updateOne(
                    { _id: task.assignedUser },
                    { $addToSet: { pendingTasks: String(task._id) } }
                );
            }

            http.created(res, task);
        } catch (err) {
            http.serverError(res);
        }
    });

    // GET /api/tasks/:id
    taskRoute.get(async function (req, res) {
        if (!query.isValidId(req.params.id)) {
            return http.notFound(res, 'Task not found');
        }

        var select = null;
        if (req.query.select !== undefined) {
            var parsedSelect = query.parseSelect(req.query.select);
            if (parsedSelect.error) return http.badRequest(res, parsedSelect.error);
            select = parsedSelect.value;
        }

        try {
            var find = Task.findById(req.params.id);
            if (select) find = find.select(select);
            var task = await find.exec();
            if (!task) return http.notFound(res, 'Task not found');
            http.ok(res, task);
        } catch (err) {
            if (err.name === 'CastError') return http.notFound(res, 'Task not found');
            http.serverError(res);
        }
    });

    // PUT /api/tasks/:id
    taskRoute.put(async function (req, res) {
        if (!query.isValidId(req.params.id)) {
            return http.notFound(res, 'Task not found');
        }

        try {
            var task = await Task.findById(req.params.id);
            if (!task) return http.notFound(res, 'Task not found');

            var body = await readTaskBody(req.body);
            if (body.error) {
                return body.error.status === 404
                    ? http.notFound(res, body.error.message)
                    : http.badRequest(res, body.error.message);
            }

            var taskId = String(task._id);
            var previousUser = task.assignedUser || '';
            var nextUser = body.value.assignedUser;
            var nextCompleted = body.value.completed;

            if (previousUser && previousUser !== nextUser) {
                await User.updateOne(
                    { _id: previousUser },
                    { $pull: { pendingTasks: taskId } }
                );
            }

            if (nextUser) {
                if (nextCompleted) {
                    // Completed tasks stay assigned but are never pending
                    await User.updateOne(
                        { _id: nextUser },
                        { $pull: { pendingTasks: taskId } }
                    );
                } else {
                    await User.updateOne(
                        { _id: nextUser },
                        { $addToSet: { pendingTasks: taskId } }
                    );
                }
            }

            task.name = body.value.name;
            task.description = body.value.description;
            task.deadline = body.value.deadline;
            task.completed = nextCompleted;
            task.assignedUser = nextUser;
            task.assignedUserName = body.value.assignedUserName;
            await task.save();

            http.ok(res, task);
        } catch (err) {
            http.serverError(res);
        }
    });

    // DELETE /api/tasks/:id
    taskRoute.delete(async function (req, res) {
        if (!query.isValidId(req.params.id)) {
            return http.notFound(res, 'Task not found');
        }

        try {
            var task = await Task.findById(req.params.id);
            if (!task) return http.notFound(res, 'Task not found');

            if (task.assignedUser) {
                await User.updateOne(
                    { _id: task.assignedUser },
                    { $pull: { pendingTasks: String(task._id) } }
                );
            }

            await task.deleteOne();
            http.noContent(res);
        } catch (err) {
            http.serverError(res);
        }
    });

    return router;
};
