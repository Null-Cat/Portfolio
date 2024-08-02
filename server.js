require('dotenv').config()
const express = require('express')
const cookieParser = require('cookie-parser')
const userAgentParser = require('ua-parser-js')
const fs = require('fs')
const mariadb = require('mariadb')
const clc = require('cli-color')
const nodemailer = require('nodemailer')
const { randomUUID } = require('crypto')
const axios = require('axios')

let nodeMailerTransporter = nodemailer.createTransport({
  host: 'mail.spacemail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'philip@philipwhite.dev',
    pass: process.env.SMTP_Password
  },
  tls: {
    rejectUnauthorized: false
  }
})
const pool = mariadb.createPool({
  host: '192.168.0.100',
  user: 'portfolio',
  database: 'portfolio',
  password: process.env.DB_PASSWORD,
  connectionLimit: 10
})

const app = express()
const port = process.env.PORT || 3000

var serverIP = ''

app.set('view engine', 'ejs')
app.set('views', './views')
app.enable('trust proxy')
app.use(express.urlencoded({ extended: true }))

app.use(LogConnections)

app.use(express.static('public'))
app.use(cookieParser())

// Middleware to log connection data to the database and set a session cookie to track returning visitors
app.use((req, res, next) => {
  // Only log connections to the database for the root URL and project pages
  if (!(req.path == '/' || req.path.includes('/projects/'))) {
    next()
    return
  }

  // Do not log connections from the server IP
  if (getTrueIP(req) == serverIP) {
    next()
    return
  }

  let sessionID = req.cookies.session_id
  if (sessionID) {
    res.cookie('session_id', sessionID, { maxAge: 44444444444, httpOnly: true, secure: true, overwrite: true })
    console.log(`${getLogTimestamp()} Returning visitor with session cookie ${sessionID}`)
  } else {
    let newSessionID = randomUUID()
    res.cookie('session_id', newSessionID, { maxAge: 44444444444, httpOnly: true, secure: true, overwrite: true })
    console.log(`${getLogTimestamp()} New visitor created session cookie ${newSessionID}`)
    sessionID = newSessionID
  }

  const ipGeolocationEndpoint = `https://freeipapi.com/api/json/${getTrueIP(req)}`
  axios
    .get(ipGeolocationEndpoint)
    .then((response) => {
      const ipGeolocationData = response.data
      pool.getConnection().then((conn) => {
        conn
          .query('INSERT INTO connection_log VALUES (UUID(), ?, ?, INET6_ATON(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, DEFAULT)', [
            sessionID,
            req.path,
            getTrueIP(req),
            req.headers['user-agent'],
            userAgentParser(req.headers['user-agent']).browser.name,
            userAgentParser(req.headers['user-agent']).os.name,
            userAgentParser(req.headers['user-agent']).device.type ? capitalizeFirstLetter(userAgentParser(req.headers['user-agent']).device.type) : 'Desktop',
            req.headers['referer'] && !(new URL(req.headers['referer']).host.includes('philipwhite.dev')) ? `${new URL(req.headers['referer']).host}${new URL(req.headers['referer']).pathname}` : null,
            ipGeolocationData.countryName == '-' ? null : ipGeolocationData.latitude,
            ipGeolocationData.countryName == '-' ? null : ipGeolocationData.longitude,
            ipGeolocationData.countryName == '-' ? null : ipGeolocationData.countryName,
            ipGeolocationData.isProxy
          ])
          .then(() => {
            conn.release()
          })
      })
    })
    .catch((error) => {
      console.error(error)
    })

  next()
})

// Render the index page for the root URL
app.get(['/', '/index', '/index.(html|php)'], (req, res) => {
  res.render('index')
})

// Render the requested project page if it exists
app.get('/projects/:id', (req, res) => {
  fs.readFile(`./views/projects/${req.params.id.toLowerCase()}.ejs`, (err) => {
    if (err) {
      res.sendStatus(404)
      console.log(`${getLogTimestamp()} ${clc.bgRed.white('404')} project ${clc.underline(req.params.id.toLowerCase())} does not exist`)
    } else {
      if (req.params.id.includes('..')) {
        console.log(`${getLogTimestamp()} ${clc.bgRed.white('403')} ${clc.underline(req.params.id.toLowerCase())} contains invalid characters`)
        res.sendStatus(403)
      } else {
        res.render(`./projects/${req.params.id.toLowerCase()}`)
      }
    }
  })
})

// API endpoint to send messages from the contact form
app.post('/api/contact', express.json(), (req, res) => {
  console.log(`${getLogTimestamp()} ${clc.inverse('POST')} request to send message from ${clc.cyan(getTrueIP(req))}`)

  if (req.body.xr) {
    console.log(`${getLogTimestamp()} ${clc.bgRed.white('403')} bot detected for ${req.body.name} ${clc.cyan(getTrueIP(req))}`)
    res.sendStatus(403)
    return
  }

  if (!(req.body.name && req.body.email && req.body.subject && req.body.message)) {
    res.sendStatus(400)
    return
  }

  if (req.body.name.length > 100 || req.body.email.length > 100 || req.body.subject.length > 100 || req.body.message.length > 1000) {
    res.sendStatus(413)
    return
  }

  let email = {
    from: `${req.body.name} <philip@philipwhite.dev>`,
    to: 'philip@philipwhite.dev',
    subject: `Portfolio Message: ${req.body.subject}`,
    text: `Name: ${req.body.name}\nEmail: ${req.body.email}\nMessage:\n${req.body.message}`
  }

  nodeMailerTransporter.sendMail(email, (err) => {
    if (err) {
      console.log(`${getLogTimestamp()} ${clc.bgRed.white('500')} failed to send message for ${req.body.name} ${clc.cyan(getTrueIP(req))} - ${err}`)
      res.sendStatus(500)
    } else {
      console.log(`${getLogTimestamp()} ${clc.bgGreen.white('200')} message sent successfully for ${req.body.name} ${clc.cyan(getTrueIP(req))}`)
      res.sendStatus(200)
    }
  })
})

// 404 any other requests
app.all('*', (req, res) => {
  res.sendStatus(404)
})

// Server start
async function init() {
  serverIP = await getServerIP()
  app.listen(port, () => {
    console.log(`${clc.green(`${getLogTimestamp()} Listening on port ${port} at ${serverIP}`)}`)
  })
}
init()

/**
 * Middleware function to log incoming connections.
 *
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {Function} next - The next middleware function.
 */
function LogConnections(req, res, next) {
  console.log(`${getLogTimestamp()} ${clc.inverse(req.method)} request for ${clc.underline(req.url)} from ${clc.cyan(getTrueIP(req))}`)
  next()
}

/**
 * Retrieves the server IP address.
 * @returns {Promise<string>} A promise that resolves with the server IP address.
 */
function getServerIP() {
  return new Promise((resolve, reject) => {
    axios
      .get('https://api.ipify.org?format=json')
      .then((response) => {
        resolve(response.data.ip)
      })
      .catch((error) => {
        console.error(error)
        reject(error)
      })
  })
}

/**
 * Retrieves the true IP address from the request object.
 * @param {Object} req - The request object.
 * @returns {string} The true IP address.
 */
function getTrueIP(req) {
  return req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress.replace('::ffff:', '')
}

/**
 * Capitalizes the first letter of a string.
 *
 * @param {string} string - The input string.
 * @returns {string} The input string with the first letter capitalized.
 */
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1)
}

/**
 * Returns a formatted timestamp for logging purposes.
 * @returns {string} The formatted timestamp in the format MM/DD/YYYY:HH:MM:SS.
 */
function getLogTimestamp() {
  let date = new Date()
  let timeStamp =
    ('00' + (date.getMonth() + 1)).slice(-2) +
    '/' +
    ('00' + date.getDate()).slice(-2) +
    '/' +
    date.getFullYear() +
    ':' +
    ('00' + date.getHours()).slice(-2) +
    ':' +
    ('00' + date.getMinutes()).slice(-2) +
    ':' +
    ('00' + date.getSeconds()).slice(-2)
  return timeStamp
}
