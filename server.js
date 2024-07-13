require('dotenv').config()
const express = require('express')
const cookieParser = require('cookie-parser')
const uaParser = require('ua-parser-js')
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

app.set('view engine', 'ejs')
app.set('views', './views')
app.enable('trust proxy')
app.use(express.urlencoded({ extended: true }))

app.use(LogConnections)

app.use(express.static('public'))
app.use(cookieParser())

app.use((req, res, next) => {
  if (!(req.path == '/' || req.path.includes('/projects/'))) {
    next()
    return
  }

  let sessionID = req.cookies.session_id
  if (sessionID) {
    res.cookie('session_id', sessionID, { maxAge: 44444444444, httpOnly: true, overwrite: true })
    console.log(`${getLogTimestamp()} Returning visitor with session cookie ${sessionID}`)
  } else {
    let newSessionID = randomUUID()
    res.cookie('session_id', newSessionID, { maxAge: 44444444444, httpOnly: true, overwrite: true })
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
            uaParser(req.headers['user-agent']).browser.name,
            uaParser(req.headers['user-agent']).os.name,
            uaParser(req.headers['user-agent']).device.type ? capitalizeFirstLetter(uaParser(req.headers['user-agent']).device.type) : 'Desktop',
            req.headers['referer'] ? req.headers['referer'] : null,
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

app.get(['/', '/index', '/index.(html|php)'], (req, res) => {
  res.render('index')
})

app.get('/projects/:id', (req, res) => {
  fs.readFile(`./views/projects/${req.params.id.toLowerCase()}.ejs`, (err, data) => {
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

app.all('*', (req, res) => {
  res.sendStatus(404)
})

function LogConnections(req, res, next) {
  console.log(`${getLogTimestamp()} ${clc.inverse(req.method)} request for ${clc.underline(req.url)} from ${clc.cyan(getTrueIP(req))}`)
  next()
}

app.listen(port, () => {
  console.log(`${clc.green(`${getLogTimestamp()} Listening on port ${port}`)}`)
})

function getTrueIP(req) {
  return req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress.replace('::ffff:', '')
}

function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1)
}

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
