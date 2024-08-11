// routes/auth.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Post = require('../models/Post');

// Login route (GET)
router.get('/login', (req, res) => {
    res.render('login');
});

// Sign up route (GET)
router.get('/signup', (req, res) => {
    res.render('signup');
});

// Sign up (POST)
router.post('/signup', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = new User({ username, password });
        await user.save();
        req.session.userId = user._id;
        res.redirect('/dashboard');
    } catch (err) {
        res.status(400).send('Error creating account');
    }
});

// Log in (POST)
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await User.findOne({ username });
        if (user && await user.comparePassword(password)) {
            req.session.userId = user._id;
            res.redirect('/dashboard');
        } else {
            res.status(400).send('Invalid credentials');
        }
    } catch (err) {
        res.status(400).send('Error logging in');
    }
});

// Logout route
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Post creation route
router.post('/posts', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    const { content } = req.body;
    try {
        const post = new Post({
            content,
            author: req.session.userId
        });
        await post.save();
        res.redirect('/dashboard');
    } catch (err) {
        res.status(400).send('Error creating post');
    }
});

// Dashboard route with posts
router.get('/dashboard', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    try {
        const posts = await Post.find().populate('author', 'username').sort({ createdAt: -1 });
        res.render('dashboard', { posts });
    } catch (err) {
        res.status(400).send('Error fetching posts');
    }
});

module.exports = router;
