'use strict';
const express = require('express');
const { search } = require('../controllers/searchController');
const router = express.Router();
router.get('/', search); // public: buyers can search before logging in
module.exports = router;
