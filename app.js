const express = require('express');
const serverless = require('serverless-http');
const session = require('express-session');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const favicon = require('serve-favicon');

const User = require('./models/User');
const Post = require('./models/Post');
const config = require('./models/config');
// Create Express app
const app = express();

// Middleware
app.use(favicon(path.join(__dirname, './public', 'favicon.ico')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, './public')));

// Use a session store compatible with serverless, or replace with JWT
const DynamoDBStore = require('connect-dynamodb')({ session: session });
app.use(session({
    store: new DynamoDBStore({
        table: 'sessions-table',
        AWSConfigJSON: {
            accessKeyId: 'your-access-key-id',
            secretAccessKey: 'your-secret-access-key',
            region: 'your-region'
        }
    }),
    secret: 'alilodhi',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Set EJS as the view engine
app.set('view engine', 'ejs');

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/social_media', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000
}).then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Failed to connect to MongoDB', err));

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Use memory storage for serverless
const upload = multer({
    storage: storage,
    limits: { fileSize: 1000000 }, // Limit file size to 1MB
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb('Error: Images Only!');
        }
    }
});

// Middleware to set req.user
app.use(async (req, res, next) => {
    if (req.session.userId) {
        try {
            req.user = await User.findById(req.session.userId);
        } catch (err) {
            console.error(err);
        }
    }
    next();
});

// Routes
app.get('/login', (req, res) => {
    res.render('login', { title: 'Login', user: req.user });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (user && await user.comparePassword(password)) {
            req.session.userId = user._id;
            res.redirect('/dashboard');
        } else {
            res.redirect('/login');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/signup', (req, res) => {
    res.render('signup', { title: 'Sign Up', user: req.user });
});

app.post('/signup', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, password: hashedPassword });
        await user.save();
        res.redirect('/login');
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    try {
        const posts = await Post.find().populate('author', 'username profilePicture').sort({ createdAt: -1 });
        const user = await User.findById(req.session.userId);
        
        // Add like count to each post
        const postsWithLikeCount = posts.map(post => ({
            ...post.toObject(),
            likeCount: post.likes.length
        }));

        res.render('dashboard', { posts: postsWithLikeCount, user });
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/posts', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    const { content } = req.body;
    try {
        const post = new Post({
            content,
            author: req.session.userId,
            createdAt: new Date()
        });
        await post.save();
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/posts/delete/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    try {
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).send('Post not found');
        }

        if (post.author.toString() !== req.session.userId) {
            return res.status(403).send('Unauthorized');
        }

        await Post.deleteOne({ _id: req.params.id });
        res.redirect('/dashboard');
    } catch (err) {
        console.error('Error deleting post:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/upload-profile-picture', upload.single('profilePicture'), async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    try {
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.redirect('/dashboard');
        }

        // Upload the image to S3 or another cloud storage and get the URL
        const profilePictureUrl = await uploadToS3(req.file);

        user.profilePicture = profilePictureUrl;
        await user.save();

        res.redirect('/profile');
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/profile', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    try {
        const user = await User.findById(req.session.userId).populate('posts');
        res.render('profile', { user: user, posts: user.posts });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.get('/user/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findById(userId)
            .populate('followers', 'username _id')
            .populate('following', 'username _id');

        const posts = await Post.find({ author: userId })
            .populate('author', 'username profilePicture')
            .sort({ createdAt: -1 });

        const followersCount = user.followers.length;
        const followingCount = user.following.length;

        const badge = assignBadge(user);

        res.render('userProfile', { 
            user: { ...user.toObject(), badge }, 
            posts, 
            currentUser: req.user,
            followersCount,
            followingCount
        });
    } catch (err) {
        console.error('Error fetching user profile:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/update-profile', upload.single('profilePicture'), async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    const { username } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (username) {
            user.username = username;
        }
        if (req.file) {
            const profilePictureUrl = await uploadToS3(req.file);
            user.profilePicture = profilePictureUrl;
        }
        await user.save();
        res.redirect('/profile');
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/follow/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    try {
        const userId = req.session.userId;
        const targetUserId = req.params.id;

        const user = await User.findById(userId);
        const targetUser = await User.findById(targetUserId);

        if (!user || !targetUser) {
            return res.status(404).send('User not found');
        }

        // Avoid following oneself
        if (userId === targetUserId) {
            return res.status(400).send('You cannot follow yourself');
        }

        if (user.following.includes(targetUserId)) {
            return res.status(400).send('You are already following this user');
        }

        user.following.push(targetUserId);
        targetUser.followers.push(userId);

        await user.save();
        await targetUser.save();

        res.redirect(`/user/${targetUserId}`);
    } catch (err) {
        console.error('Error following user:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/unfollow/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    try {
        const userId = req.session.userId;
        const targetUserId = req.params.id;

        const user = await User.findById(userId);
        const targetUser = await User.findById(targetUserId);

        if (!user || !targetUser) {
            return res.status(404).send('User not found');
        }

        user.following = user.following.filter(id => id.toString() !== targetUserId);
        targetUser.followers = targetUser.followers.filter(id => id.toString() !== userId);

        await user.save();
        await targetUser.save();

        res.redirect(`/user/${targetUserId}`);
    } catch (err) {
        console.error('Error unfollowing user:', err);
        res.status(500).send('Internal Server Error');
    }
});

// Helper function to upload file to S3
async function uploadToS3(file) {
    // Implement your S3 upload logic here
    return 'https://your-s3-bucket-url/' + file.filename;
}

// Export the Express app as a serverless function
module.exports.handler = serverless(app);
