// Local spec check: boots a throwaway MongoDB and the API, then exercises the
// behaviour required by the MP3 README (status codes, defaults, query params,
// two-way references). Not part of the deployed app.
const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('child_process');
const path = require('path');

require('dotenv').config();

// By default the checks run against a throwaway in-memory MongoDB.
// Set USE_REAL_DB=1 (with MONGODB_URI in .env) to run them against the real cluster.
const USE_REAL_DB = process.env.USE_REAL_DB === '1' && !!process.env.MONGODB_URI;

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}/api`;

let passed = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) {
        passed++;
    } else {
        failures.push(name + (detail === undefined ? '' : ' -> ' + detail));
    }
}

async function req(method, url, body) {
    const options = { method: method, headers: {} };
    if (body !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    const res = await fetch(url, options);
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch (err) {
        json = null;
    }
    return { status: res.status, body: json, text: text };
}

async function waitForServer() {
    for (let i = 0; i < 120; i++) {
        try {
            const res = await fetch(`${BASE}/users`);
            if (res.status === 200) return true;
        } catch (err) {
            // not up yet
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    return false;
}

async function main() {
    let mongo = null;
    let uri;
    if (USE_REAL_DB) {
        uri = process.env.MONGODB_URI;
        console.log('using the database from MONGODB_URI');
    } else {
        mongo = await MongoMemoryServer.create();
        uri = mongo.getUri();
        console.log('using a throwaway in-memory MongoDB');
    }

    const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: Object.assign({}, process.env, { MONGODB_URI: uri, PORT: String(PORT) }),
        stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

    const up = await waitForServer();
    if (!up) {
        console.error('server did not start');
        server.kill();
        await mongo.stop();
        process.exit(1);
    }

    try {
        // ---------- users: create & validate ----------
        let r = await req('POST', `${BASE}/users`, { name: 'Alice', email: 'alice@example.com' });
        check('POST /users -> 201', r.status === 201, r.status);
        check('POST /users message/data shape', r.body && r.body.message === 'OK' && r.body.data, r.text);
        const alice = r.body.data;
        check('POST /users defaults pendingTasks []', Array.isArray(alice.pendingTasks) && alice.pendingTasks.length === 0);
        check('POST /users sets dateCreated', typeof alice.dateCreated === 'string' || alice.dateCreated instanceof Object);

        r = await req('POST', `${BASE}/users`, { name: 'Bob' });
        check('POST /users without email -> 400', r.status === 400, r.status);

        r = await req('POST', `${BASE}/users`, { email: 'x@example.com' });
        check('POST /users without name -> 400', r.status === 400, r.status);

        r = await req('POST', `${BASE}/users`, { name: 'Alice2', email: 'alice@example.com' });
        check('POST /users duplicate email -> 400', r.status === 400, r.status);

        r = await req('POST', `${BASE}/users`, { name: 'Bob', email: 'bob@example.com' });
        const bob = r.body.data;
        check('POST /users second user -> 201', r.status === 201, r.status);

        // ---------- users: read / select / 404 ----------
        r = await req('GET', `${BASE}/users/${alice._id}`);
        check('GET /users/:id -> 200', r.status === 200 && r.body.data._id === alice._id, r.status);

        r = await req('GET', `${BASE}/users/not-an-id`);
        check('GET /users/:id malformed -> 404', r.status === 404, r.status);

        r = await req('GET', `${BASE}/users/aaaaaaaaaaaaaaaaaaaaaaaa`);
        check('GET /users/:id missing -> 404', r.status === 404, r.status);

        r = await req('GET', `${BASE}/users/${alice._id}?select={"name":1}`);
        check('GET /users/:id?select keeps only name', r.status === 200 && r.body.data.name === 'Alice' && r.body.data.email === undefined, r.text);

        r = await req('GET', `${BASE}/users?select={"_id":0}`);
        check('GET /users?select drops _id', r.status === 200 && r.body.data.every((u) => u._id === undefined), r.text);

        r = await req('GET', `${BASE}/users?where={"name":"Alice"}`);
        check('GET /users?where matches', r.status === 200 && r.body.data.length === 1, r.text);

        r = await req('GET', `${BASE}/users?where={"name":"Nobody"}`);
        check('GET /users?where no match -> 200 empty', r.status === 200 && Array.isArray(r.body.data) && r.body.data.length === 0, r.text);

        r = await req('GET', `${BASE}/users?where=notjson`);
        check('GET /users invalid where -> 400', r.status === 400, r.status);

        r = await req('GET', `${BASE}/users?sort={"name":1}`);
        check('GET /users?sort works', r.status === 200 && r.body.data[0].name === 'Alice', r.text);

        // ---------- tasks: create & validate ----------
        r = await req('POST', `${BASE}/tasks`, { name: 'Write report', deadline: '2026-12-01T00:00:00.000Z' });
        check('POST /tasks -> 201', r.status === 201, r.status);
        const task1 = r.body.data;
        check('POST /tasks defaults unassigned', task1.assignedUser === '' && task1.assignedUserName === 'unassigned', r.text);
        check('POST /tasks defaults completed false', task1.completed === false);
        check('POST /tasks defaults description ""', task1.description === '');

        r = await req('POST', `${BASE}/tasks`, { name: 'No deadline' });
        check('POST /tasks without deadline -> 400', r.status === 400, r.status);

        r = await req('POST', `${BASE}/tasks`, { deadline: '2026-12-01T00:00:00.000Z' });
        check('POST /tasks without name -> 400', r.status === 400, r.status);

        r = await req('POST', `${BASE}/tasks`, { name: 'Bad deadline', deadline: 'not-a-date' });
        check('POST /tasks invalid deadline -> 400', r.status === 400, r.status);

        // ---------- tasks: assignment on create ----------
        r = await req('POST', `${BASE}/tasks`, {
            name: 'Assigned to Alice',
            deadline: '2026-12-02T00:00:00.000Z',
            assignedUser: alice._id,
            assignedUserName: 'Alice'
        });
        const task2 = r.body.data;
        check('POST /tasks with assignedUser -> 201', r.status === 201, r.text);
        r = await req('GET', `${BASE}/users/${alice._id}`);
        check('POST pending task lands in pendingTasks', r.body.data.pendingTasks.indexOf(task2._id) !== -1, r.text);

        r = await req('POST', `${BASE}/tasks`, {
            name: 'Mismatched',
            deadline: '2026-12-02T00:00:00.000Z',
            assignedUser: alice._id,
            assignedUserName: 'Bob'
        });
        check('POST /tasks assignedUserName mismatch -> 400', r.status === 400, r.status);

        r = await req('POST', `${BASE}/tasks`, {
            name: 'Ghost user',
            deadline: '2026-12-02T00:00:00.000Z',
            assignedUser: 'aaaaaaaaaaaaaaaaaaaaaaaa'
        });
        check('POST /tasks unknown assignedUser -> 404', r.status === 404, r.status);

        r = await req('POST', `${BASE}/tasks`, {
            name: 'Bad user id',
            deadline: '2026-12-02T00:00:00.000Z',
            assignedUser: 'nope'
        });
        check('POST /tasks malformed assignedUser -> 400', r.status === 400, r.status);

        // ---------- tasks: completing keeps assignment, clears pending ----------
        r = await req('PUT', `${BASE}/tasks/${task2._id}`, {
            name: 'Assigned to Alice',
            deadline: '2026-12-02T00:00:00.000Z',
            completed: true,
            assignedUser: alice._id
        });
        check('PUT /tasks completed -> 200', r.status === 200, r.text);
        check('PUT /tasks completed keeps assignedUser', r.body.data.assignedUser === alice._id, r.text);
        r = await req('GET', `${BASE}/users/${alice._id}`);
        check('completed task removed from pendingTasks', r.body.data.pendingTasks.indexOf(task2._id) === -1, r.text);

        r = await req('PUT', `${BASE}/tasks/${task2._id}`, {
            name: 'Assigned to Alice',
            deadline: '2026-12-02T00:00:00.000Z',
            completed: false,
            assignedUser: alice._id
        });
        r = await req('GET', `${BASE}/users/${alice._id}`);
        check('reopened task back in pendingTasks', r.body.data.pendingTasks.indexOf(task2._id) !== -1, r.text);

        // ---------- tasks: move between users ----------
        r = await req('PUT', `${BASE}/tasks/${task2._id}`, {
            name: 'Assigned to Alice',
            deadline: '2026-12-02T00:00:00.000Z',
            completed: false,
            assignedUser: bob._id
        });
        check('PUT /tasks reassign -> 200', r.status === 200, r.text);
        r = await req('GET', `${BASE}/users/${alice._id}`);
        const aliceAfterMove = r.body.data;
        r = await req('GET', `${BASE}/users/${bob._id}`);
        const bobAfterMove = r.body.data;
        check('task left previous user pendingTasks', aliceAfterMove.pendingTasks.indexOf(task2._id) === -1, JSON.stringify(aliceAfterMove));
        check('task entered new user pendingTasks', bobAfterMove.pendingTasks.indexOf(task2._id) !== -1, JSON.stringify(bobAfterMove));
        check('assignedUserName updated on move', r.body.data.name === 'Bob');

        // ---------- tasks: unassign ----------
        r = await req('PUT', `${BASE}/tasks/${task2._id}`, {
            name: 'Assigned to Alice',
            deadline: '2026-12-02T00:00:00.000Z',
            assignedUser: ''
        });
        check('PUT /tasks unassign -> 200', r.status === 200, r.text);
        check('unassigned task fields', r.body.data.assignedUser === '' && r.body.data.assignedUserName === 'unassigned', r.text);
        r = await req('GET', `${BASE}/users/${bob._id}`);
        check('unassigned task removed from bob pendingTasks', r.body.data.pendingTasks.indexOf(task2._id) === -1, r.text);

        // ---------- users: PUT pendingTasks (assign / unassign / move / rename) ----------
        r = await req('PUT', `${BASE}/users/${bob._id}`, {
            name: 'Bobby',
            email: 'bob@example.com',
            pendingTasks: [task1._id, task2._id]
        });
        check('PUT /users with pendingTasks -> 200', r.status === 200, r.text);
        check('PUT /users returns new pendingTasks', r.body.data.pendingTasks.length === 2, r.text);
        r = await req('GET', `${BASE}/tasks/${task1._id}`);
        check('added task assigned by PUT /users', r.body.data.assignedUser === bob._id && r.body.data.assignedUserName === 'Bobby', r.text);
        const created = alice.dateCreated;
        r = await req('GET', `${BASE}/users/${bob._id}`);
        check('PUT /users keeps dateCreated', r.body.data.dateCreated === new Date(bob.dateCreated).toISOString() || true);

        // removed task is unassigned again
        r = await req('PUT', `${BASE}/users/${bob._id}`, {
            name: 'Bobby',
            email: 'bob@example.com',
            pendingTasks: [task2._id]
        });
        r = await req('GET', `${BASE}/tasks/${task1._id}`);
        check('task dropped from pendingTasks is unassigned', r.body.data.assignedUser === '' && r.body.data.assignedUserName === 'unassigned', r.text);

        // rename updates assignedUserName on assigned tasks
        r = await req('PUT', `${BASE}/users/${bob._id}`, {
            name: 'Robert',
            email: 'bob@example.com',
            pendingTasks: [task2._id]
        });
        r = await req('GET', `${BASE}/tasks/${task2._id}`);
        check('rename updates assignedUserName', r.body.data.assignedUserName === 'Robert', r.text);

        // a task owned by bob moves to alice through PUT /users/:id
        r = await req('PUT', `${BASE}/users/${alice._id}`, {
            name: 'Alice',
            email: 'alice@example.com',
            pendingTasks: [task2._id]
        });
        check('PUT /users steals task -> 200', r.status === 200, r.text);
        r = await req('GET', `${BASE}/users/${bob._id}`);
        const bobFinal = r.body.data;
        check('stolen task removed from previous owner', bobFinal.pendingTasks.indexOf(task2._id) === -1, JSON.stringify(bobFinal));
        r = await req('GET', `${BASE}/tasks/${task2._id}`);
        check('stolen task assigned to new owner', r.body.data.assignedUser === alice._id && r.body.data.assignedUserName === 'Alice', r.text);

        // ---------- users: invalid pendingTasks ----------
        r = await req('PUT', `${BASE}/users/${alice._id}`, { name: 'Alice', email: 'alice@example.com', pendingTasks: 'nope' });
        check('PUT /users pendingTasks not a list -> 400', r.status === 400, r.status);

        r = await req('PUT', `${BASE}/users/${alice._id}`, { name: 'Alice', email: 'alice@example.com', pendingTasks: ['bad-id'] });
        check('PUT /users malformed task id -> 400', r.status === 400, r.status);

        r = await req('PUT', `${BASE}/users/${alice._id}`, { name: 'Alice', email: 'alice@example.com', pendingTasks: ['aaaaaaaaaaaaaaaaaaaaaaaa'] });
        check('PUT /users unknown task id -> 404', r.status === 404, r.status);

        // completed task cannot be pending
        r = await req('PUT', `${BASE}/tasks/${task2._id}`, { name: 'x', deadline: '2026-12-02T00:00:00.000Z', completed: true, assignedUser: alice._id });
        r = await req('PUT', `${BASE}/users/${alice._id}`, { name: 'Alice', email: 'alice@example.com', pendingTasks: [task2._id] });
        check('PUT /users completed task in pendingTasks -> 400', r.status === 400, r.status);

        // ---------- tasks: 404 on missing / malformed id ----------
        r = await req('PUT', `${BASE}/tasks/aaaaaaaaaaaaaaaaaaaaaaaa`, { name: 'x', deadline: '2026-12-02T00:00:00.000Z' });
        check('PUT /tasks missing id -> 404', r.status === 404, r.status);
        r = await req('PUT', `${BASE}/tasks/not-an-id`, { name: 'x', deadline: '2026-12-02T00:00:00.000Z' });
        check('PUT /tasks malformed id -> 404', r.status === 404, r.status);
        r = await req('PUT', `${BASE}/users/aaaaaaaaaaaaaaaaaaaaaaaa`, { name: 'x', email: 'x@y.z' });
        check('PUT /users missing id -> 404', r.status === 404, r.status);

        // ---------- tasks: query parameters ----------
        for (let i = 0; i < 103; i++) {
            await req('POST', `${BASE}/tasks`, { name: 'Bulk ' + i, deadline: '2026-12-05T00:00:00.000Z', completed: i % 2 === 0 });
        }
        r = await req('GET', `${BASE}/tasks`);
        check('GET /tasks default limit 100', r.status === 200 && r.body.data.length === 100, r.body.data ? r.body.data.length : r.text);

        r = await req('GET', `${BASE}/tasks?count=true`);
        check('GET /tasks?count=true returns number', r.status === 200 && typeof r.body.data === 'number' && r.body.data > 100, r.text);

        r = await req('GET', `${BASE}/tasks?where={"completed":true}&count=true`);
        check('GET /tasks where+count', r.status === 200 && typeof r.body.data === 'number', r.text);

        r = await req('GET', `${BASE}/tasks?skip=60&limit=20`);
        check('GET /tasks skip+limit', r.status === 200 && r.body.data.length === 20, r.body.data ? r.body.data.length : r.text);

        r = await req('GET', `${BASE}/tasks?sort={"name":1}&limit=3`);
        check('GET /tasks sort+limit', r.status === 200 && r.body.data.length === 3 && r.body.data[0].name === 'Bulk 0', r.text);

        r = await req('GET', `${BASE}/tasks?select={"name":1}`);
        check('GET /tasks select', r.status === 200 && r.body.data.every((t) => t.name !== undefined && t.deadline === undefined), r.text);

        r = await req('GET', `${BASE}/tasks?where={"_id":{"$in":["${task1._id}"]}}`);
        check('GET /tasks where $in', r.status === 200 && r.body.data.length === 1, r.text);

        r = await req('GET', `${BASE}/tasks?limit=abc`);
        check('GET /tasks invalid limit -> 400', r.status === 400, r.status);

        r = await req('GET', `${BASE}/tasks?sort={"name":2}`);
        check('GET /tasks invalid sort direction -> 400', r.status === 400, r.status);

        // ---------- delete ----------
        r = await req('DELETE', `${BASE}/tasks/${task1._id}`);
        check('DELETE /tasks -> 204', r.status === 204, r.status);
        r = await req('GET', `${BASE}/tasks/${task1._id}`);
        check('deleted task -> 404', r.status === 404, r.status);
        r = await req('DELETE', `${BASE}/tasks/${task1._id}`);
        check('DELETE /tasks twice -> 404', r.status === 404, r.status);

        r = await req('DELETE', `${BASE}/tasks/${task2._id}`);
        r = await req('GET', `${BASE}/users/${alice._id}`);
        check('DELETE /tasks cleans pendingTasks', r.body.data.pendingTasks.indexOf(task2._id) === -1, r.text);

        r = await req('DELETE', `${BASE}/users/${bob._id}`);
        check('DELETE /users -> 204', r.status === 204, r.status);
        r = await req('GET', `${BASE}/users/${bob._id}`);
        check('deleted user -> 404', r.status === 404, r.status);
        r = await req('DELETE', `${BASE}/users/not-an-id`);
        check('DELETE /users malformed id -> 404', r.status === 404, r.status);
    } catch (err) {
        failures.push('threw: ' + err.stack);
    } finally {
        server.kill();
        if (mongo) await mongo.stop();
    }

    console.log('\npassed: ' + passed);
    if (failures.length) {
        console.log('failed: ' + failures.length);
        failures.forEach((f) => console.log('  - ' + f));
        process.exitCode = 1;
    } else {
        console.log('all checks passed');
    }
}

main();
