const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const cors = require('cors');
const path = require('path');
const http = require('http');
const nodemailer = require('nodemailer');
const router = express.Router();
const { broadcast } = require('./websocketServer');
const { initWebSocketNotifServer, broadcastNotification } = require('./webSocketServerNotif');

const app = express();
const port = 3306;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

// Serve static files from 'uploads' directory
app.use('/new/uploads', express.static(path.join(__dirname, 'uploads')));

const db = mysql.createConnection({
  host: 'sql208.infinityfree.com',
  user: 'if0_37704271',
  password: '4j9uCIwufO1RJ3S ',
  database: 'if0_37704271_reporting'
});

const query = (sql, params) => new Promise((resolve, reject) => {
  db.query(sql, params, (error, results) => {
    if (error) return reject(error);
    resolve(results);
  });
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
    process.exit(1);
  }
  console.log('MySQL connected...');
});

const server = http.createServer(app);
initWebSocketNotifServer(server);

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).send('Username and password are required');
  }

  // Check if the user is a resident
  const sqlResident = 'SELECT * FROM residents WHERE username = ? AND password = ?';
  db.query(sqlResident, [username, password], (err, result) => {
    if (err) {
      console.error('Database query error:', err);
      return res.status(500).send('Server error');
    }

    // If a resident is found
    if (result.length > 0) {
      const user = result[0];
      return res.json({
        success: true,
        userId: user.id,
        role: 'resident',  // Indicate that the user is a resident
        message: 'Login successful'
      });
    }

    // If no resident, check if the user is a police officer
    const sqlPolice = 'SELECT * FROM police WHERE username = ? AND password = ?';
    db.query(sqlPolice, [username, password], (err, result) => {
      if (err) {
        console.error('Database query error:', err);
        return res.status(500).send('Server error');
      }

      // If a police officer is found
      if (result.length > 0) {
        const user = result[0];
        return res.json({
          success: true,
          userId: user.id,
          role: 'police',  // Indicate that the user is a police officer
          message: 'Login successful'
        });
      }

      // Invalid credentials for both resident and police
      return res.status(401).send('Invalid credentials');
    });
  });
});


app.post('/signup', (req, res) => {
  const {
    fullName,
    birthDate,
    barangay,
    phoneNumber,
    proofOfResidency,
    emailAddress,
    username,
    password,
    gender
  } = req.body;

  // Perform any additional validation if needed

  const sql = 'INSERT INTO residents (fullname, birthdate, barangay, phone, residency, email, username, password, gender) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
  db.query(sql, [fullName, birthDate, barangay, phoneNumber, proofOfResidency, emailAddress, username, password, gender], (err, result) => {
    if (err) {
      console.error('Error saving resident:', err);
      res.status(500).send('Error saving data');
      return;
    }
    console.log('New resident added:', result);
    res.status(200).send('Sign up successful');
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
    res.json(results);
  });
});

app.post('/submitReport', (req, res) => {
  const {
    userId,
    category,
    victimName,
    victimAddress,
    victimContact,
    file,
    witnessName,
    witnessContact,
    crimeDate,
    crimeTime,
    crimeDescription,
    injuryOrDamages,
    evidence_Type,
    descripEvidence,
    dateEvidence,
    location,
    evidence,
    status
  } = req.body;

  // Directly use witnessName and witnessContact if they are already comma-separated strings
  const witnessNames = typeof witnessName === 'string' ? witnessName : '';
  const witnessContacts = typeof witnessContact === 'string' ? witnessContact : '';

  const sql = 'INSERT INTO reports (user_id, category, name, address, contact, valid_id, witness, witnessNo, crimeDate, time, description, injury, status, evidenceType, evidenceDescription, evidenceDate, location, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);';

  db.query(sql, [userId, category, victimName, victimAddress, victimContact, file, witnessNames, witnessContacts, crimeDate, crimeTime, crimeDescription, injuryOrDamages, status, evidence_Type, descripEvidence, dateEvidence, location, evidence], (err, result) => {
    if (err) {
      console.error('Error saving report:', err);
      res.status(500).send('Error saving data');
      return;
    }
    console.log('New report added:', result);
    res.status(200).send('Report submitted successfully');
  });
});

app.post('/submitEmergency', (req, res) => {
  const { lat, combinedLocation } = req.body;

  if (!lat || !combinedLocation) {
    res.status(400).send('Location data is required');
    return;
  }
  // Assuming the emergency reports table is called 'emergencies'
  const sql = 'INSERT INTO emergency (lat, location) VALUES (?, ?)';

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

  const query = 'SELECT * FROM files WHERE user_id = ? ORDER BY time DESC';
  db.query(query, [userId], (error, results) => {
    if (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).send('Server error');
      return;
    }
    res.json(results);

    // Broadcasting the notification
    results.forEach(notification => broadcastNotification(notification));
  });
});

app.get('/reports', (req, res) => {
  const userId = req.query.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  const query = 'SELECT * FROM reports WHERE user_id = ?;';
  db.query(query, [userId], (error, results) => {
    if (error) {
      console.error('Error fetching reports:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'No reports found for this user' });
    }

    res.json(results); // Send the entire array of reports
  });
});

const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000); // Generate a 6-digit code
};

app.post('/send-verification', async (req, res) => {
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
});

// New endpoint to fetch username based on user ID
app.get('/api/users/:id', (req, res) => {
  const userId = req.params.id;

  // Query to fetch the username based on user ID
  const sql = 'SELECT username FROM residents WHERE id = ?';
  db.query(sql, [userId], (error, results) => {
    if (error) {
      console.error('Error fetching user:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const username = results[0].username;
    res.json({ username });
  });
});

app.post('/send-verification', async (req, res) => {
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
});

app.post('/validate-verification-code', async (req, res) => {
  const { userId, code } = req.body;

  try {
    const [resident] = await query('SELECT verification_code FROM residents WHERE id = ?', [userId]);

    if (!resident) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (resident.verification_code === code) {
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
    // Update the password in the database
    await query('UPDATE residents SET password = ? WHERE id = ?', [newPassword, userId]);

    res.status(200).json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


app.post('/saveMessage', (req, res) => {
  const { userId, police, notif } = req.body;

  const query = 'INSERT INTO notifications (userId, police_id, notif, chat_date) VALUES (?, ?, ?, NOW())';
  
  db.query(query, [userId, police, notif], (error, results) => {
    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({ success: false, message: 'Database error', error });
    }
    return res.status(200).json({ success: true, message: 'Message sent successfully' });
  });
});


app.get('/api/emergencies', (req, res) => {
  const query = 'SELECT * FROM emergency WHERE status IS NULL'; // Query to fetch emergencies with status = null
  db.query(query, (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch emergencies' });
    }
    res.json(result); // Send the result back to the client
  });
});

app.put('/api/emergencies/:id/respond', (req, res) => {
  const emergencyId = req.params.id;

  // Update the emergency status to 'Respond'
  const query = `UPDATE emergency SET status = 'Respond' WHERE id = ?`;

  db.query(query, [emergencyId], (error, result) => {
    if (error) {
      console.error('Error updating emergency status:', error);
      res.status(500).json({ message: 'Error updating emergency status' });
    } else {
      res.status(200).json({ message: 'Emergency status updated to Respond' });
    }
  });
});


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
