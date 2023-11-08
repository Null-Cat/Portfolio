const express = require('express')
const fs = require('fs')
const clc = require('cli-color')
const argv = require('yargs')(process.argv.slice(2)).command('dev', 'Run the server in development mode').alias('dev', 'd').argv

const app = express()
const port = process.env.PORT || 3000

app.set('view engine', 'ejs')
app.set('views', './views')
app.enable('trust proxy')
app.use(express.urlencoded({ extended: true }))

app.use(LogConnections)

// app.all('*', (req, res, next) => {
//   var isLocal = req.socket.localAddress === req.socket.remoteAddress
//   if (!argv.dev && !req.secure && !isLocal) {
//     res.redirect(308, 'https://' + req.headers.host + req.url)
// 	console.log(`${logTimestamp} ${clc.bgRed.white('308')} Upgrading connection`)
//   } else next()
// })

app.use(express.static('public'))

app.get(['/', '/index', '/index.(html|php)'], (req, res) => {
  res.render('index')
})

app.get('/projects/:id', (req, res) => {
  fs.readFile(`./views/projects/${req.params.id.toLowerCase()}.ejs`, (err, data) => {
    if (err) {
      res.sendStatus(404)
      console.log(`${logTimestamp} ${clc.bgRed.white('404')} project ${clc.underline(req.params.id.toLowerCase())} does not exist`)
    } else {
      if (req.params.id.includes('..')) {
        console.log(`${logTimestamp} ${clc.bgRed.white('403')} ${clc.underline(req.params.id.toLowerCase())} contains invalid characters`)
        res.sendStatus(403)
      } else {
        res.render(`./projects/${req.params.id.toLowerCase()}`)
      }
    }
  })
})

app.all('*', (req, res) => {
  res.sendStatus(404)
})

function LogConnections(req, res, next) {
  console.log(
    `${logTimestamp} ${clc.inverse(req.method)} request for ${clc.underline(req.url)} from ${clc.cyan(
      req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress
    )}`
  )
  next()
}

app.listen(port, () => {
  if (argv.dev) console.log(`${clc.yellow(`Server in development mode ${clc.bold('NO SSL')}`)}`)
  console.log(`${clc.green(`Listening on port ${port}`)}`)
})

var date = new Date(),
  logTimestamp =
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
