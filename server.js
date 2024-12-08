const express = require('express');
const bodyParser = require('body-parser');
const { Client } = require('pg');  // Import the pg library
const cors = require('cors');
const path = require('path');
const http = require('http');
const nodemailer = require('nodemailer');
const router = express.Router();
const { broadcast } = require('./websocketServer');
const { initWebSocketNotifServer, broadcastNotification } = require('./webSocketServerNotif');


const app = express();
const port = process.env.PORT || 10000;

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

// Serve static files from 'uploads' directory
app.use('/new/uploads', express.static(path.join(__dirname, 'uploads')));

const db = new Client({
  connectionString: "postgresql://reporting_ia98_user:C1S8UVRh7jFTCjOkAuuV4qoZXgPfPIGG@dpg-csonachu0jms738mmhng-a/reporting_ia98",
  ssl: {
    rejectUnauthorized: false, // This is to handle SSL certificates for the hosted database
  }
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to PostgreSQL:', err);
    process.exit(1);
  }
  console.log('PostgreSQL connected...');
});

const server = http.createServer(app);
initWebSocketNotifServer(server);

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).send('Username and password are required');
  }

  try {
    // Check if the user is a resident
    const sqlResident = 'SELECT * FROM residents WHERE username = $1 AND password = $2';
    const residentResult = await db.query(sqlResident, [username, password]);

    if (residentResult.rows.length > 0) {
      const user = residentResult.rows[0];
      return res.json({
        success: true,
        userId: user.id,
        role: 'resident',  // Indicate that the user is a resident
        message: 'Login successful'
      });
    }

    // If no resident, check if the user is a police officer
    const sqlPolice = 'SELECT * FROM police WHERE username = $1 AND password = $2';
    const policeResult = await db.query(sqlPolice, [username, password]);

    if (policeResult.rows.length > 0) {
      const user = policeResult.rows[0];
      return res.json({
        success: true,
        userId: user.id,
        role: 'police',  // Indicate that the user is a police officer
        message: 'Login successful'
      });
    }

    // Invalid credentials for both resident and police
    return res.status(401).send('Invalid credentials');
  } catch (err) {
    console.error('Database query error:', err);
    return res.status(500).send('Server error');
  }
});

app.post('/signup', (req, res) => {
  const {
    firstname,
    lastName,
    birthDate,
    barangay,
    phoneNumber,
    proofOfResidency,
    emailAddress,
    username,
    password,
    gender,
  } = req.body;

  const fullName = `${firstname} ${lastName}`;

  // SQL query to insert resident data into the residents table
  const sql = 'INSERT INTO residents (fullname, firstname, lastname, birthdate, barangay, phone, residency, email, username, password, gender) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)';
  
  // Execute the query using db.query
  db.query(sql, [fullName, firstname, lastName, birthDate, barangay, phoneNumber, proofOfResidency, emailAddress, username, password, gender], (err, result) => {
    if (err) {
      console.error('Error saving resident:', err);
      return res.status(500).send('Error saving data');
    }
    console.log('New resident added:', result);
    return res.status(200).send('Sign up successful');
  });
});

app.get('/barangays', (req, res) => {
  const sql = 'SELECT id, barangay FROM barangay';
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching barangays:', err);
      res.status(500).send('Error fetching barangays');
      return;
    }
    // Send only the rows array, which contains the desired data
    res.json(results.rows);
  });
});




app.post('/submitReport', (req, res) => {
    const {
        userId,
        category,
        victimName,
        victimAddress,
        victimContact,
        witnessName,
        witnessContact,
        crimeDate,
        crimeTime,
        crimeDescription,
        status,
        gender,
        sitio,
    } = req.body;

    // Check if userId is null or undefined
    if (!userId) {
        return res.status(400).send({ error: 'User ID is required' });
    }

    const time = new Date(crimeTime).toISOString().split('T')[1].split('.')[0];

    const sql = `
        INSERT INTO reports (
            user_id, 
            category, 
            name, 
            address, 
            contact, 
            witness, 
            witnessno, 
            crimedate, 
            time, 
            description, 
            status,
            gender,
            sitio
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;

    db.query(
        sql,
        [
            userId,
            category,
            victimName,
            victimAddress,
            victimContact,
            witnessName,
            witnessContact,
            crimeDate,
            time,
            crimeDescription,
            status,
            gender,
            sitio,
        ],
        (err, result) => {
            if (err) {
              console.error('Error saving report:', err.message);
              res.status(500).send({ error: 'Error saving data', details: err.message });
              return;
          }
          console.log('New report added:', result);
          res.status(200).send({ message: 'Report submitted successfully' });
      }
    );
});




app.post('/submitEmergency', (req, res) => {
  const { lat, combinedLocation } = req.body;

  if (!lat || !combinedLocation) {
    res.status(400).send('Location data is required');
    return;
  }

  // Update query to use PostgreSQL parameterized syntax ($1, $2)
  const sql = 'INSERT INTO emergency (lat, location) VALUES ($1, $2)';

  db.query(sql, [lat, combinedLocation], (err, result) => {
    if (err) {
      console.error('Database query error:', err);
      res.status(500).send('Server error');
      return;
    }
    console.log('New emergency report added:', result);

    // Broadcasting the emergency alert
    broadcast(JSON.stringify({
      type: 'emergencyAlert',
      data: {
        combinedLocation,
      }
    }));

    res.status(200).send('Emergency report submitted successfully');
  });
});


app.get('/notifications', (req, res) => {
  const userId = req.query.user_id; // Retrieve user_id from query parameters
  if (!userId) {
    return res.status(400).send('User ID is required');
  }

  // Modify query syntax to use `$1` for parameterized queries in PostgreSQL
  const query = 'SELECT * FROM files WHERE user_id = $1 ORDER BY time DESC';
  db.query(query, [userId], (error, result) => {
    if (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).send('Server error');
      return;
    }

    res.json(result.rows);

    // Broadcasting the notification for each row
    result.rows.forEach(notification => broadcastNotification(notification));
  });
});

app.get('/reports', (req, res) => {
  const userId = req.query.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  // Modify the query to use `$1` for PostgreSQL parameterized syntax
  const query = 'SELECT * FROM reports WHERE user_id = $1;';
  db.query(query, [userId], (error, result) => {
    if (error) {
      console.error('Error fetching reports:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No reports found for this user' });
    }

    res.json(result.rows); // Send only the rows (array of reports) in the response
  });
});


const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000); // Generate a 6-digit code
};

/*app.post('/send-verification', async (req, res) => {
  const { userId } = req.body;

  try {
    const [resident] = await query('SELECT email FROM residents WHERE id = ?', [userId]);

    if (!resident) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const email = resident.email;
    const verificationCode = generateVerificationCode();

    // Setup Nodemailer transporter
    const transporter = nodemailer.createTransport({
      service: 'Gmail', // Or any other email service you prefer
      auth: {
        user: 'st.peter.lifeplansinsurance@gmail.com',
        pass: 'scuhbuyjyujshdeo',
      },
    });

    // Email content
    const mailOptions = {
      from: 'st.peter.lifeplansinsurance@gmail.com',
      to: email,
      subject: 'Your Verification Code',
      text: `Your verification code is: ${verificationCode}`,
    };

    // Send the email
    await transporter.sendMail(mailOptions);

    // Optionally, store the verification code in the database for later validation
    await query('UPDATE residents SET verification_code = ? WHERE id = ?', [verificationCode, userId]);

    res.status(200).json({ success: true, message: 'Verification code sent successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});*/

// New endpoint to fetch username based on user ID
app.get('/api/users/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    // PostgreSQL parameterized query syntax
    const { rows } = await db.query('SELECT username FROM residents WHERE id = $1', [userId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const username = rows[0].username;
    res.json({ username });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.post('/send-verification', async (req, res) => {
  const { userId } = req.body;

  try {
    // Use PostgreSQL parameterized query syntax
    const { rows } = await db.query('SELECT email FROM residents WHERE id = $1', [userId]);
    const resident = rows[0];

    if (!resident) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const email = resident.email;
    const verificationCode = generateVerificationCode();

    // Setup Nodemailer transporter
    const transporter = nodemailer.createTransport({
      service: 'Gmail',
      auth: {
        user: 'st.peter.lifeplansinsurance@gmail.com',
        pass: 'scuhbuyjyujshdeo',
      },
    });

    // Email content
    const mailOptions = {
      from: 'st.peter.lifeplansinsurance@gmail.com',
      to: email,
      subject: 'Your Verification Code',
      text: `Your verification code is: ${verificationCode}`,
    };

    // Send the email
    await transporter.sendMail(mailOptions);

    // Store the verification code in the database
    await db.query('UPDATE residents SET verification_code = $1 WHERE id = $2', [verificationCode, userId]);

    res.status(200).json({ success: true, message: 'Verification code sent successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/validate-verification-code', async (req, res) => {
  const { userId, code } = req.body;

  try {
    // Using PostgreSQL syntax with parameterized queries
    const { rows } = await db.query('SELECT verification_code FROM residents WHERE id = $1', [userId]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const verificationCode = rows[0].verification_code;

    if (verificationCode === code) {
      res.status(200).json({ success: true, message: 'Verification code valid' });
    } else {
      res.status(400).json({ success: false, message: 'Invalid verification code' });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});



app.post('/reset-password', async (req, res) => {
  const { userId, newPassword } = req.body;

  try {
    // Update the password in the PostgreSQL database
    await db.query('UPDATE residents SET password = $1 WHERE id = $2', [newPassword, userId]);

    res.status(200).json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


app.post('/saveMessage', (req, res) => {
  const { userId, police, notif } = req.body;

  // SQL query to insert data
  const query = 'INSERT INTO notifications (userid, police_id, notif, chat_date) VALUES ($1, $2, $3, NOW())';
  
  db.query(query, [userId, police, notif], (error, results) => {
    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({ success: false, message: 'Database error', error });
    }
    return res.status(200).json({ success: true, message: 'Message sent successfully' });
  });
});

app.get('/api/emergencies', (req, res) => {
  const query = "SELECT * FROM emergency WHERE status IN ('Coming', '', NULL)"; 
  
  db.query(query, (err, result) => {
    if (err) {
      console.error('Error executing query:', err);  // Log the error for debugging
      return res.status(500).json({ error: 'Failed to fetch emergencies' });
    }

    // Check if result.rows is an array and send the result
    if (Array.isArray(result.rows)) {
      res.json(result.rows); // Send the rows back to the client
    } else {
      console.error('Unexpected result format:', result);
      res.status(500).json({ error: 'Unexpected response format from database' });
    }
  });
});


app.put('/api/emergencies/:id/respond', (req, res) => {
  const emergencyId = req.params.id;

  // Query to update the emergency status to 'Respond'
  const query = 'UPDATE emergency SET status = $1 WHERE id = $2';

  db.query(query, ['Respond', emergencyId], (error, result) => {
    if (error) {
      console.error('Error updating emergency status:', error);
      return res.status(500).json({ message: 'Error updating emergency status' });
    }

    if (result.rowCount === 0) {
      // If no rows were affected, it means the emergency ID was not found
      return res.status(404).json({ message: 'Emergency not found' });
    }

    // If successful, respond with a success message
    res.status(200).json({ message: 'Emergency status updated to Respond' });
  });
});

app.get('/api/users/:id', (req, res) => {
  const userId = req.params.id;

  // Query to fetch username, password, and email based on user ID
  const sql = 'SELECT username, password, email FROM residents WHERE id = $1';
  
  db.query(sql, [userId], (error, result) => {
    if (error) {
      console.error('Error fetching user:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Log the full result to see the structure
    console.log('Database result:', result.rows);

    // Destructure the fields from the result
    const { username, password, email } = result.rows[0];
    
    // Return the user data as JSON
    res.json({ username, password, email });
  });
});

app.get('/api/police/location/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    // Query to fetch police station based on officer_id using parameterized query for security
    const sql = 'SELECT station FROM police WHERE id = $1';
    const result = await db.query(sql, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Police station not found for this officer' });
    }

    // Assuming `station` is a string like "latitude,longitude"
    const policeStation = result.rows[0];
    const [latitude, longitude] = policeStation.station.split(',');

    // Create an object to hold the latitude and longitude dynamically
    const policeStationLocation = {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
    };

    // Return the location as a JSON response
    res.json(policeStationLocation);
  } catch (err) {
    console.error('Error fetching police station location:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/policenotifications', (req, res) => {
  const query = "SELECT location, report_date FROM emergency WHERE status IS NULL OR status = 'Responding' ORDER BY report_date DESC"; 
  db.query(query, (error, result) => {
    if (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).send('Server error');
      return;
    }

    res.json(result.rows);

    // Broadcasting the notification for each row
    result.rows.forEach(notification => broadcastNotification(notification));
  });
});

app.put('/api/emergencies/:id/responding', (req, res) => {
  const emergencyId = req.params.id;

  // Query to update the emergency status to 'Respond'
  const query = 'UPDATE emergency SET status = $1 WHERE id = $2';

  db.query(query, ['Responding', emergencyId], (error, result) => {
    if (error) {
      console.error('Error updating emergency status:', error);
      return res.status(500).json({ message: 'Error updating emergency status' });
    }

    if (result.rowCount === 0) {
      // If no rows were affected, it means the emergency ID was not found
      return res.status(404).json({ message: 'Emergency not found' });
    }

    // If successful, respond with a success message
    res.status(200).json({ message: 'Emergency status updated to Respond' });
  });
});


