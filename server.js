const express = require('express');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcrypt');
const session = require('express-session');
const app = express();
const PORT = 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// Configure session
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

let users = [];
let jobs = [];
let activeProviders = new Map(); // Track active service providers

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login.html');
    }
};

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/jobs', (req, res) => {
    const { category, lat, lng, radius } = req.query;
    let filteredJobs = [...jobs];

    if (category) {
        filteredJobs = filteredJobs.filter(job => job.category.toLowerCase() === category.toLowerCase());
    }

    if (lat && lng && radius) {
        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const searchRadius = parseFloat(radius);

        filteredJobs = filteredJobs.filter(job => {
            const distance = calculateDistance(
                userLat, userLng,
                job.latitude, job.longitude
            );
            return distance <= searchRadius;
        });

        filteredJobs = filteredJobs.map(job => ({
            ...job,
            distance: calculateDistance(userLat, userLng, job.latitude, job.longitude),
            isAvailable: activeProviders.has(job.userId),
            lastSeen: activeProviders.get(job.userId)?.lastSeen
        }));

        filteredJobs.sort((a, b) => {
            // Sort by availability first, then by distance
            if (a.isAvailable !== b.isAvailable) {
                return a.isAvailable ? -1 : 1;
            }
            return a.distance - b.distance;
        });
    }

    res.json(filteredJobs);
});

// Update provider availability
app.post('/update-availability', requireAuth, (req, res) => {
    const { isAvailable, latitude, longitude } = req.body;
    const userId = req.session.user.id;

    if (isAvailable) {
        activeProviders.set(userId, {
            lastSeen: new Date(),
            location: { latitude, longitude }
        });
    } else {
        activeProviders.delete(userId);
    }

    res.json({ success: true });
});

app.post('/register', upload.fields([
    { name: 'profilePicture', maxCount: 1 },
    { name: 'workPhotos', maxCount: 5 },
    { name: 'menuPhotos', maxCount: 5 }
]), async (req, res) => {
    try {
        const { 
            username, 
            email, 
            password, 
            phone,
            street,
            city,
            state,
            postalCode,
            userType, 
            category,
            description,
            hourlyRate,
            skills,
            experience,
            serviceRadius,
            startTime,
            endTime,
            workingDays,
            facebook,
            instagram,
            linkedin,
            cuisineType,
            maxGuests,
            dietaryOptions,
            equipmentProvided,
            setupTime,
            cleaningTypes,
            cleaningEquipment,
            cleaningSupplies,
            teamSize
        } = req.body;
        
        // Validate required fields
        if (!username || !email || !password || !phone || !street || !city || !state || !postalCode) {
            return res.status(400).json({ error: 'All required fields must be filled' });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Validate phone number format
        const phoneRegex = /^\+?[\d\s-]{10,}$/;
        if (!phoneRegex.test(phone)) {
            return res.status(400).json({ error: 'Invalid phone number format' });
        }

        // Check if email already exists
        if (users.some(u => u.email === email)) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        // Check if username already exists
        if (users.some(u => u.username === username)) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        // Validate password strength
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({ 
                error: 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character' 
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create base user object
        const user = {
            id: Date.now(),
            username,
            email,
            password: hashedPassword,
            phone,
            address: {
                street,
                city,
                state,
                postalCode
            },
            userType,
            createdAt: new Date().toISOString(),
            isVerified: false,
            verificationToken: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
        };

        // Add service provider specific fields
        if (userType === 'service_provider') {
            user.category = category;
            user.description = description;
            user.hourlyRate = parseFloat(hourlyRate);
            user.skills = skills ? skills.split(',').map(skill => skill.trim()) : [];
            user.experience = experience;
            user.serviceRadius = parseInt(serviceRadius);
            user.availability = {
                startTime,
                endTime,
                workingDays: workingDays ? workingDays.split(',') : []
            };
            user.socialMedia = {
                facebook,
                instagram,
                linkedin
            };
            user.profilePicture = req.files['profilePicture'] ? `/uploads/${req.files['profilePicture'][0].filename}` : null;
            user.workPhotos = req.files['workPhotos'] ? req.files['workPhotos'].map(file => `/uploads/${file.filename}`) : [];
            user.menuPhotos = req.files['menuPhotos'] ? req.files['menuPhotos'].map(file => `/uploads/${file.filename}`) : [];

            // Add catering-specific fields
            if (category === 'catering') {
                user.cuisineType = cuisineType;
                user.maxGuests = parseInt(maxGuests);
                user.dietaryOptions = dietaryOptions ? JSON.parse(dietaryOptions) : [];
                user.equipmentProvided = equipmentProvided ? JSON.parse(equipmentProvided) : [];
                user.setupTime = parseInt(setupTime);
            }
            // Add cleaning-specific fields
            else if (category === 'cleaning') {
                user.cleaningTypes = cleaningTypes ? JSON.parse(cleaningTypes) : [];
                user.cleaningEquipment = cleaningEquipment ? JSON.parse(cleaningEquipment) : [];
                user.cleaningSupplies = cleaningSupplies ? JSON.parse(cleaningSupplies) : [];
                user.teamSize = parseInt(teamSize);
            }
        }

        // Add user to database
        users.push(user);

        // Set session
        req.session.user = user;

        // Send verification email (simulated)
        console.log(`Verification email sent to ${email} with token: ${user.verificationToken}`);

        // Redirect based on user type
        if (userType === 'customer') {
            res.redirect('/login.html');
        } else {
            res.redirect('/provider-login.html');
        }
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password, userType } = req.body;
        const user = users.find(u => u.email === email && u.userType === userType);

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        req.session.user = user;
        
        // Redirect based on user type
        if (userType === 'service_provider') {
            res.redirect('/provider-dashboard.html');
        } else {
            res.redirect('/');
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login.html');
});

app.post('/add-job', requireAuth, upload.fields([
    { name: 'profilePicture', maxCount: 1 },
    { name: 'workPhotos', maxCount: 5 },
    { name: 'menuPhotos', maxCount: 5 }
]), (req, res) => {
    try {
        const { 
            title, 
            category, 
            location, 
            description, 
            latitude, 
            longitude, 
            experience, 
            hourlyRate, 
            skills,
            cuisineType,
            maxGuests,
            dietaryOptions,
            equipmentProvided,
            setupTime,
            cleaningTypes,
            cleaningEquipment,
            cleaningSupplies,
            teamSize
        } = req.body;
        
        const profilePicture = req.files['profilePicture'] ? `/uploads/${req.files['profilePicture'][0].filename}` : null;
        const workPhotos = req.files['workPhotos'] ? req.files['workPhotos'].map(file => `/uploads/${file.filename}`) : [];
        const menuPhotos = req.files['menuPhotos'] ? req.files['menuPhotos'].map(file => `/uploads/${file.filename}`) : [];
        
        if (title && location && description && category && latitude && longitude) {
            const jobData = {
                id: Date.now(),
                title,
                category,
                location,
                description,
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                createdAt: new Date().toISOString(),
                userId: req.session.user.id,
                profilePicture,
                workPhotos,
                menuPhotos,
                experience: experience || 'Not specified',
                hourlyRate: hourlyRate || 'Not specified',
                skills: skills ? skills.split(',').map(skill => skill.trim()) : [],
                rating: 0,
                reviews: [],
                isAvailable: false
            };

            // Add catering-specific fields if the category is catering
            if (category === 'catering') {
                jobData.cuisineType = cuisineType || 'Not specified';
                jobData.maxGuests = maxGuests || 'Not specified';
                jobData.dietaryOptions = dietaryOptions ? JSON.parse(dietaryOptions) : [];
                jobData.equipmentProvided = equipmentProvided || 'Not specified';
                jobData.setupTime = setupTime || 'Not specified';
            }
            // Add cleaning-specific fields if the category is cleaning
            else if (category === 'cleaning') {
                jobData.cleaningTypes = cleaningTypes ? JSON.parse(cleaningTypes) : [];
                jobData.cleaningEquipment = cleaningEquipment ? JSON.parse(cleaningEquipment) : [];
                jobData.cleaningSupplies = cleaningSupplies ? JSON.parse(cleaningSupplies) : [];
                jobData.teamSize = teamSize || 'Not specified';
            }

            jobs.push(jobData);
            res.redirect('/');
        } else {
            res.status(400).json({ error: 'Missing required fields' });
        }
    } catch (error) {
        console.error('Add job error:', error);
        res.status(500).json({ error: 'Failed to add job' });
    }
});

// Helper function to calculate distance between two points
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Clean up inactive providers every 5 minutes
setInterval(() => {
    const now = new Date();
    for (const [userId, data] of activeProviders.entries()) {
        if (now - data.lastSeen > 5 * 60 * 1000) { // 5 minutes
            activeProviders.delete(userId);
        }
    }
}, 5 * 60 * 1000);

// Add stats endpoint
app.get('/stats', requireAuth, (req, res) => {
    const userId = req.session.user.id;
    const userJobs = jobs.filter(job => job.userId === userId);
    const totalJobs = userJobs.length;
    
    // Calculate average rating
    const ratings = userJobs.flatMap(job => job.reviews.map(review => review.rating));
    const rating = ratings.length > 0 
        ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
        : '0.0';
    
    // Calculate active hours (simplified for demo)
    const activeHours = Math.floor(Math.random() * 100);
    
    // Count unique customers
    const customers = new Set(userJobs.flatMap(job => job.reviews.map(review => review.customerId)));
    const totalCustomers = customers.size;

    res.json({
        totalJobs,
        rating,
        activeHours,
        totalCustomers
    });
});

// Add notification endpoint
app.get('/notifications', requireAuth, (req, res) => {
    const userId = req.session.user.id;
    const userJobs = jobs.filter(job => job.userId === userId);
    
    // Get recent reviews and messages (simplified for demo)
    const notifications = [
        ...userJobs.flatMap(job => 
            job.reviews
                .filter(review => new Date(review.date) > new Date(Date.now() - 24 * 60 * 60 * 1000))
                .map(review => ({
                    type: 'review',
                    message: `New review for ${job.title}`,
                    date: review.date
                }))
        ),
        ...userJobs.flatMap(job =>
            job.messages
                .filter(message => new Date(message.date) > new Date(Date.now() - 24 * 60 * 60 * 1000))
                .map(message => ({
                    type: 'message',
                    message: `New message about ${job.title}`,
                    date: message.date
                }))
        )
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json(notifications);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});