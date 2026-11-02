// Helpers for the JSON encoded query string parameters:
// where, sort, select, skip, limit, count.
var mongoose = require('mongoose');

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonParam(raw, name) {
    if (typeof raw !== 'string') {
        return { error: name + ' must be a single JSON string' };
    }
    try {
        return { value: JSON.parse(raw) };
    } catch (err) {
        return { error: name + ' must be valid JSON' };
    }
}

function parseInteger(raw, name, min) {
    if (typeof raw !== 'string' || raw.trim() === '' || !/^-?\d+$/.test(raw.trim())) {
        return { error: name + ' must be an integer' };
    }
    var value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min) {
        return { error: name + ' must be an integer greater than or equal to ' + min };
    }
    return { value: value };
}

// Reads every supported parameter of a collection GET request.
// Returns { error } when the client sent something we cannot use.
function buildCollectionQuery(query, options) {
    var opts = options || {};
    var result = {
        filter: {},
        projection: null,
        sort: null,
        skip: 0,
        limit: opts.defaultLimit === undefined ? null : opts.defaultLimit,
        count: false
    };

    if (query.where !== undefined) {
        var where = parseJsonParam(query.where, 'where');
        if (where.error) return { error: where.error };
        if (!isPlainObject(where.value)) return { error: 'where must be a JSON object' };
        result.filter = where.value;
    }

    if (query.sort !== undefined) {
        var sort = parseJsonParam(query.sort, 'sort');
        if (sort.error) return { error: sort.error };
        if (!isPlainObject(sort.value)) return { error: 'sort must be a JSON object' };
        var sortKeys = Object.keys(sort.value);
        for (var i = 0; i < sortKeys.length; i++) {
            var direction = sort.value[sortKeys[i]];
            if (direction !== 1 && direction !== -1) {
                return { error: 'sort values must be 1 (ascending) or -1 (descending)' };
            }
        }
        result.sort = sort.value;
    }

    if (query.select !== undefined) {
        var projection = parseSelect(query.select);
        if (projection.error) return { error: projection.error };
        result.projection = projection.value;
    }

    if (query.skip !== undefined) {
        var skip = parseInteger(query.skip, 'skip', 0);
        if (skip.error) return { error: skip.error };
        result.skip = skip.value;
    }

    if (query.limit !== undefined) {
        var limit = parseInteger(query.limit, 'limit', 1);
        if (limit.error) return { error: limit.error };
        result.limit = limit.value;
    }

    if (query.count !== undefined) {
        if (query.count !== 'true' && query.count !== 'false') {
            return { error: 'count must be true or false' };
        }
        result.count = query.count === 'true';
    }

    return result;
}

// select is allowed both on collections and on a single /:id resource.
function parseSelect(raw) {
    var select = parseJsonParam(raw, 'select');
    if (select.error) return { error: select.error };
    if (!isPlainObject(select.value)) return { error: 'select must be a JSON object' };
    var keys = Object.keys(select.value);
    for (var i = 0; i < keys.length; i++) {
        var flag = select.value[keys[i]];
        if (flag !== 1 && flag !== 0) {
            return { error: 'select values must be 1 (include) or 0 (exclude)' };
        }
    }
    return { value: select.value };
}

function isValidId(id) {
    return typeof id === 'string' && mongoose.Types.ObjectId.isValid(id);
}

module.exports = {
    buildCollectionQuery: buildCollectionQuery,
    parseSelect: parseSelect,
    isValidId: isValidId
};
