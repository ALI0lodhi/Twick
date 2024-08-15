const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const User = require('./models/User');
const Post = require('./models/Post');
const favicon = require('serve-favicon');
const config = require('./config'); // Ensure config file exists and is correct

// Create Express app
const app = express();
const port = 3000;

// Serve favicon
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public')); // Serve static files from 'public' directory

// Session configuration
app.use(session({
    secret: 'alilodhi', // Replace with a real secret key
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Set EJS as the view engine
app.set('view engine', 'ejs');

app.use(cors(
    {
        origin: ['https://twick-nk5o4n9j5-alis-projects-b3e6ec04.vercel.app'],
        methods: ["POST", "GET"],
        credentials: true
    }
));

// Connect to MongoDB
mongoose.connect('mongodb+srv://dev:alidev@cluster0.5vmqm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('Failed to connect to MongoDB', err));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/'); // Directory to save uploaded files
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); // Append date to file name
    }
});

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

// Badge assignment logic
const assignBadge = (user) => {
    if (config.specialUserIds.includes(user._id.toString()) || user.customBadge) {
        return user.badge; // Use the custom badge if set or if the user is in the special list
    }

    const followersCount = user.followers.length;
    if (followersCount >= 5) {
        return 'Bronze';
    } else if (followersCount >= 2) {
        return 'Mascot';
    }
    return 'No Badge'; // Default badge
};

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

// Route Handlers

// Display login page
app.get('/login', (req, res) => {
    res.render('login', { title: 'Login', user: req.user });
});

// Handle login form submission
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

// Display sign-up page
app.get('/signup', (req, res) => {
    res.render('signup', { title: 'Sign Up', user: req.user });
});

// Handle sign-up form submission
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

// Display dashboard
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

// Handle new post submission
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

// Handle deleting a post
app.post('/posts/delete/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    try {
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).send('Post not found');
        }

        // Check if the post belongs to the logged-in user
        if (post.author.toString() !== req.session.userId) {
            return res.status(403).send('Unauthorized');
        }

        await Post.deleteOne({ _id: req.params.id }); // Delete the post
        res.redirect('/dashboard'); // Redirect to dashboard or another page
    } catch (err) {
        console.error('Error deleting post:', err);
        res.status(500).send('Internal Server Error');
    }
});

// Handle profile picture upload
app.post('/upload-profile-picture', upload.single('profilePicture'), async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    try {
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.redirect('/dashboard');
        }

        // Update profile picture URL
        user.profilePicture = `/uploads/${req.file.filename}`;
        await user.save();

        res.redirect('/profile');
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

// Route for user editing their own profile
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

// User profile
app.get('/user/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findById(userId)
            .populate('followers', 'username _id') // Fetch followers for count
            .populate('following', 'username _id'); // Fetch following for count

        const posts = await Post.find({ author: userId })
            .populate('author', 'username profilePicture')
            .sort({ createdAt: -1 });

        const followersCount = user.followers.length;
        const followingCount = user.following.length;

        const badge = assignBadge(user); // Determine badge

        res.render('userProfile', { 
            user: { ...user.toObject(), badge }, // Include computed badge
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

// Handle updating profile
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
            user.profilePicture = `/uploads/${req.file.filename}`;
        }
        await user.save();
        res.redirect('/profile');
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

// Route to handle Follow
app.post('/follow/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    try {
        const userToFollowId = req.params.id;
        const currentUser = await User.findById(req.session.userId);

        // Check if user is already following the userToFollow
        if (currentUser.following.includes(userToFollowId)) {
            return res.redirect('/profile'); // Or appropriate redirect
        }

        // Add the userToFollow to currentUser's following list
        currentUser.following.push(userToFollowId);
        await currentUser.save();

        // Add currentUser to userToFollow's followers list
        const userToFollow = await User.findById(userToFollowId);
        userToFollow.followers.push(req.session.userId);

        // Update badge after follow
        userToFollow.badge = assignBadge(userToFollow); // Use the updated badge function
        await userToFollow.save();

        res.redirect('/dashboard'); // Or redirect to user's profile page
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

// Handle unfollow
app.post('/unfollow/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    try {
        const userToUnfollowId = req.params.id;
        const currentUser = await User.findById(req.session.userId);

        // Check if user is already following the userToUnfollow
        if (!currentUser.following.includes(userToUnfollowId)) {
            return res.redirect('/dashboard'); // Or appropriate redirect
        }

        // Remove the userToUnfollow from currentUser's following list
        currentUser.following.pull(userToUnfollowId);
        await currentUser.save();

        // Remove currentUser from userToUnfollow's followers list
        const userToUnfollow = await User.findById(userToUnfollowId);
        userToUnfollow.followers.pull(req.session.userId);
        
        // Update badge after unfollow
        userToUnfollow.badge = assignBadge(userToUnfollow); // Use the updated badge function
        await userToUnfollow.save();

        res.redirect('/dashboard'); // Or redirect to user's profile page
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

// Like a post
app.post('/posts/like/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    try {
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).send('Post not found');
        }

        const userId = req.session.userId;
        // Check if the user has already liked the post
        const index = post.likes.indexOf(userId);
        if (index === -1) {
            // If not liked, add the user's ID to the likes array
            post.likes.push(userId);
        } else {
            // If already liked, remove the user's ID from the likes array
            post.likes.splice(index, 1);
        }

        await post.save();
        res.redirect('back'); // Redirect back to the page the user was on
    } catch (err) {
        console.error('Error handling like:', err);
        res.status(500).send('Internal Server Error');
    }
});

// Handle logout
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error(err);
            res.status(500).send('Internal Server Error');
        } else {
            res.redirect('/login');
        }
    });
});

// 404 Not Found
app.use((req, res) => {
    res.status(404).render('404', { title: '404 Not Found', user: req.user });
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}/login`);
});
