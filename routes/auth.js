const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Post = require('../models/Post');
const bcrypt = require('bcrypt');
const session = require('express-session');
const MongoStore = require('connect-mongo');

// Setup session with MongoDB session store
router.use(session({
    secret: process.env.SESSION_SECRET || 'hhfty63468',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' }, // Use secure cookies in production
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI, // MongoDB connection string
        ttl: 14 * 24 * 60 * 60 // 14 days expiration
    })
}));

// Middleware to check if the user is logged in
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
};

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
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, password: hashedPassword });
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
        if (user && await bcrypt.compare(password, user.password)) {
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
    req.session.destroy(err => {
        if (err) {
            return res.status(500).send('Error logging out');
        }
        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

// Post creation route
router.post('/posts', isAuthenticated, async (req, res) => {
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
router.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
        const posts = await Post.find().populate('author', 'username').sort({ createdAt: -1 });
        res.render('dashboard', { posts });
    } catch (err) {
        res.status(400).send('Error fetching posts');
    }
});

module.exports = router;
