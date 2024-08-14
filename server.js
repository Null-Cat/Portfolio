require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const uaParser = require("./ua-parser-js/src/main/ua-parser");
const uaParserExtensions = require("./ua-parser-js/src/extensions/ua-parser-extensions");
const userAgentParser = new uaParser(uaParserExtensions);
const fs = require("fs");
const mariadb = require("mariadb");
const clc = require("cli-color");
const nodemailer = require("nodemailer");
const { randomUUID } = require("crypto");
const axios = require("axios");

let nodeMailerTransporter = nodemailer.createTransport({
  host: "mail.spacemail.com",
  port: 465,
  secure: true,
  auth: {
    user: "philip@philipwhite.dev",
    pass: process.env.SMTP_Password,
  },
  tls: {
    rejectUnauthorized: false,
  },
});
const pool = mariadb.createPool({
  host: "192.168.0.100",
  user: "portfolio",
  database: "portfolio",
  password: process.env.DB_PASSWORD,
  connectionLimit: 10,
});

const app = express();
const port = process.env.PORT || 3000;

var serverIP = "";

app.set("view engine", "ejs");
app.set("views", "./views");
app.enable("trust proxy");
app.use(express.urlencoded({ extended: true }));

app.use(LogConnections);

app.use(express.static("public"));
app.use(cookieParser());

// Middleware to log connection data to the database and set a session cookie to track returning visitors
app.use((req, res, next) => {
  // Only log connections to the database for the root URL and project pages
  if (!(req.path == "/" || req.path.includes("/projects/"))) {
    next();
    return;
  }

  // Do not log connections from the server IP
  if (getTrueIP(req) == serverIP) {
    next();
    return;
  }

  let sessionID = req.cookies.session_id;
  if (sessionID) {
    res.cookie("session_id", sessionID, {
      maxAge: 44444444444,
      httpOnly: true,
      secure: true,
      overwrite: true,
    });
    console.log(
      `${getLogTimestamp()} Returning visitor with session cookie ${sessionID}`
    );
  } else {
    let newSessionID = randomUUID();
    res.cookie("session_id", newSessionID, {
      maxAge: 44444444444,
      httpOnly: true,
      secure: true,
      overwrite: true,
    });
    console.log(
      `${getLogTimestamp()} New visitor created session cookie ${newSessionID}`
    );
    sessionID = newSessionID;
  }

  const ipGeolocationEndpoint = `https://freeipapi.com/api/json/${getTrueIP(
    req
  )}`;
  axios
    .get(ipGeolocationEndpoint)
    .then((response) => {
      const ipGeolocationData = response.data;
      const uaParserData = userAgentParser.setUA(req.headers["user-agent"]);
      pool.getConnection().then((conn) => {
        conn
          .query(
            "INSERT INTO connection_log VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DEFAULT)",
            [
              sessionID,
              req.path,
              getTrueIP(req),
              req.headers["user-agent"],
              uaParserData.getBrowser().name,
              uaParserData.getOS().name,
              uaParserData.getDevice().type
                ? capitalizeFirstLetter(uaParserData.getDevice().type)
                : "Desktop",
              req.headers["referer"] &&
              !new URL(req.headers["referer"]).host.includes("philipwhite.dev")
                ? `${new URL(req.headers["referer"]).host}${
                    new URL(req.headers["referer"]).pathname
                  }`
                : null,
              ipGeolocationData.countryName == "-"
                ? null
                : ipGeolocationData.latitude,
              ipGeolocationData.countryName == "-"
                ? null
                : ipGeolocationData.longitude,
              ipGeolocationData.countryName == "-"
                ? null
                : ipGeolocationData.countryName,
              ipGeolocationData.isProxy,
              uaParserData.getBrowser().type == "crawler" ? true : false,
            ]
          )
          .then(() => {
            conn.release();
          });
      });
    })
    .catch((error) => {
      console.error(error);
    });

  next();
});

// Render the index page for the root URL
app.get(["/", "/index", "/index.(html|php)"], (req, res) => {
  res.render("index");
});

// Render the requested project page if it exists
app.get("/projects/:id", (req, res) => {
  fs.readFile(`./views/projects/${req.params.id.toLowerCase()}.ejs`, (err) => {
    if (err) {
      res.sendStatus(404);
      console.log(
        `${getLogTimestamp()} ${clc.bgRed.white("404")} project ${clc.underline(
          req.params.id.toLowerCase()
        )} does not exist`
      );
    } else {
      if (req.params.id.includes("..")) {
        console.log(
          `${getLogTimestamp()} ${clc.bgRed.white("403")} ${clc.underline(
            req.params.id.toLowerCase()
          )} contains invalid characters`
        );
        res.sendStatus(403);
      } else {
        res.render(`./projects/${req.params.id.toLowerCase()}`);
      }
    }
  });
});

// API endpoint to send messages from the contact form
app.post("/api/contact", express.json(), (req, res) => {
  console.log(
    `${getLogTimestamp()} ${clc.inverse(
      "POST"
    )} request to send message from ${clc.cyan(getTrueIP(req))}`
  );

  if (req.body.xr) {
    console.log(
      `${getLogTimestamp()} ${clc.bgRed.white("403")} bot detected for ${
        req.body.name
      } ${clc.cyan(getTrueIP(req))}`
    );
    res.sendStatus(403);
    return;
  }

  if (
    !(req.body.name && req.body.email && req.body.subject && req.body.message)
  ) {
    res.sendStatus(400);
    return;
  }

  if (
    req.body.name.length > 100 ||
    req.body.email.length > 100 ||
    req.body.subject.length > 100 ||
    req.body.message.length > 1000
  ) {
    res.sendStatus(413);
    return;
  }

  let email = {
    from: `"${req.body.name}" <philip@philipwhite.dev>`,
    to: "philip@philipwhite.dev",
    replyTo: req.body.email,
    subject: `Portfolio Message: ${req.body.subject}`,
    text: `Name: ${req.body.name}\nEmail: ${req.body.email}\nMessage:\n${req.body.message}`,
    html: contactEmailTemplateHTML(
      req.body.name,
      req.body.email,
      req.body.subject,
      req.body.message
    ),
  };

  nodeMailerTransporter.sendMail(email, (err) => {
    if (err) {
      console.log(
        `${getLogTimestamp()} ${clc.bgRed.white(
          "500"
        )} failed to send message for ${req.body.name} ${clc.cyan(
          getTrueIP(req)
        )} - ${err}`
      );
      res.sendStatus(500);
    } else {
      console.log(
        `${getLogTimestamp()} ${clc.bgGreen.white(
          "200"
        )} message sent successfully for ${req.body.name} ${clc.cyan(
          getTrueIP(req)
        )}`
      );
      res.sendStatus(200);
    }
  });
});

// 404 any other requests
app.all("*", (req, res) => {
  res.sendStatus(404);
});

// Server start
async function init() {
  serverIP = await getServerIP();
  app.listen(port, () => {
    console.log(
      `${clc.green(
        `${getLogTimestamp()} Listening on port ${port} at ${serverIP}`
      )}`
    );
  });
}
init();

/**
 * Middleware function to log incoming connections.
 *
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {Function} next - The next middleware function.
 */
function LogConnections(req, res, next) {
  console.log(
    `${getLogTimestamp()} ${clc.inverse(
      req.method
    )} request for ${clc.underline(req.url)} from ${clc.cyan(getTrueIP(req))}`
  );
  next();
}

/**
 * Retrieves the server IP address.
 * @returns {Promise<string>} A promise that resolves with the server IP address.
 */
function getServerIP() {
  return new Promise((resolve, reject) => {
    axios
      .get("https://api.ipify.org?format=json")
      .then((response) => {
        resolve(response.data.ip);
      })
      .catch((error) => {
        console.error(error);
        reject(error);
      });
  });
}

/**
 * Retrieves the true IP address from the request object.
 * @param {Object} req - The request object.
 * @returns {string} The true IP address.
 */
function getTrueIP(req) {
  return req.headers["x-forwarded-for"]
    ? req.headers["x-forwarded-for"].split(",")[0]
    : req.socket.remoteAddress.replace("::ffff:", "");
}

/**
 * Capitalizes the first letter of a string.
 *
 * @param {string} string - The input string.
 * @returns {string} The input string with the first letter capitalized.
 */
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

/**
 * Returns a formatted timestamp for logging purposes.
 * @returns {string} The formatted timestamp in the format MM/DD/YYYY:HH:MM:SS.
 */
function getLogTimestamp() {
  let date = new Date();
  let timeStamp =
    ("00" + (date.getMonth() + 1)).slice(-2) +
    "/" +
    ("00" + date.getDate()).slice(-2) +
    "/" +
    date.getFullYear() +
    ":" +
    ("00" + date.getHours()).slice(-2) +
    ":" +
    ("00" + date.getMinutes()).slice(-2) +
    ":" +
    ("00" + date.getSeconds()).slice(-2);
  return timeStamp;
}

/**
 * Generates an HTML template for a contact email.
 *
 * @param {string} name - The name of the contact.
 * @param {string} email - The email address of the contact.
 * @param {string} subject - The subject of the email.
 * @param {string} message - The message content of the email.
 * @returns {string} - The generated HTML template for the contact email.
 */
function contactEmailTemplateHTML(name, email, subject, message) {
  return `
    <!DOCTYPE HTML PUBLIC "-//W3C//DTD XHTML 1.0 Transitional //EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<!--[if gte mso 9]>
<xml>
  <o:OfficeDocumentSettings>
    <o:AllowPNG/>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings>
</xml>
<![endif]-->
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <!--[if !mso]><!--><meta http-equiv="X-UA-Compatible" content="IE=edge"><!--<![endif]-->
  <title></title>
  
    <style type="text/css">
      @media only screen and (min-width: 520px) {
  .u-row {
    width: 500px !important;
  }
  .u-row .u-col {
    vertical-align: top;
  }

  .u-row .u-col-33p33 {
    width: 166.65px !important;
  }

  .u-row .u-col-66p67 {
    width: 333.35px !important;
  }

  .u-row .u-col-100 {
    width: 500px !important;
  }

}

@media (max-width: 520px) {
  .u-row-container {
    max-width: 100% !important;
    padding-left: 0px !important;
    padding-right: 0px !important;
  }
  .u-row .u-col {
    min-width: 320px !important;
    max-width: 100% !important;
    display: block !important;
  }
  .u-row {
    width: 100% !important;
  }
  .u-col {
    width: 100% !important;
  }
  .u-col > div {
    margin: 0 auto;
  }
}
body {
  margin: 0;
  padding: 0;
}

table,
tr,
td {
  vertical-align: top;
  border-collapse: collapse;
}

p {
  margin: 0;
}

.ie-container table,
.mso-container table {
  table-layout: fixed;
}

* {
  line-height: inherit;
}

a[x-apple-data-detectors='true'] {
  color: inherit !important;
  text-decoration: none !important;
}

table, td { color: #ffffff; } #u_body a { color: #0d6efd; text-decoration: underline; }
    </style>
  
  

<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css?family=Montserrat:400,700&display=swap" rel="stylesheet" type="text/css"><!--<![endif]-->

</head>

<body class="clean-body u_body" style="margin: 0;padding: 0;-webkit-text-size-adjust: 100%;background-color: #000000;color: #ffffff">
  <!--[if IE]><div class="ie-container"><![endif]-->
  <!--[if mso]><div class="mso-container"><![endif]-->
  <table id="u_body" style="border-collapse: collapse;table-layout: fixed;border-spacing: 0;mso-table-lspace: 0pt;mso-table-rspace: 0pt;vertical-align: top;min-width: 320px;Margin: 0 auto;background-color: #000000;width:100%" cellpadding="0" cellspacing="0">
  <tbody>
  <tr style="vertical-align: top">
    <td style="word-break: break-word;border-collapse: collapse !important;vertical-align: top">
    <!--[if (mso)|(IE)]><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background-color: #000000;"><![endif]-->
    
  
  
<div class="u-row-container" style="padding: 0px;background-color: transparent">
  <div class="u-row" style="margin: 0 auto;min-width: 320px;max-width: 500px;overflow-wrap: break-word;word-wrap: break-word;word-break: break-word;background-color: transparent;">
    <div style="border-collapse: collapse;display: table;width: 100%;height: 100%;background-color: transparent;">
      <!--[if (mso)|(IE)]><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding: 0px;background-color: transparent;" align="center"><table cellpadding="0" cellspacing="0" border="0" style="width:500px;"><tr style="background-color: transparent;"><![endif]-->
      
<!--[if (mso)|(IE)]><td align="center" width="500" style="width: 500px;padding: 0px;border-top: 0px solid transparent;border-left: 0px solid transparent;border-right: 0px solid transparent;border-bottom: 0px solid transparent;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;" valign="top"><![endif]-->
<div class="u-col u-col-100" style="max-width: 320px;min-width: 500px;display: table-cell;vertical-align: top;">
  <div style="height: 100%;width: 100% !important;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;">
  <!--[if (!mso)&(!IE)]><!--><div style="box-sizing: border-box; height: 100%; padding: 0px;border-top: 0px solid transparent;border-left: 0px solid transparent;border-right: 0px solid transparent;border-bottom: 0px solid transparent;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;"><!--<![endif]-->
  
<table style="font-family:'Montserrat',sans-serif;" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
  <tbody>
    <tr>
      <td style="overflow-wrap:break-word;word-break:break-word;padding:10px;font-family:'Montserrat',sans-serif;" align="left">
        
  <table height="0px" align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;table-layout: fixed;border-spacing: 0;mso-table-lspace: 0pt;mso-table-rspace: 0pt;vertical-align: top;border-top: 10px solid #0d6efd;-ms-text-size-adjust: 100%;-webkit-text-size-adjust: 100%">
    <tbody>
      <tr style="vertical-align: top">
        <td style="word-break: break-word;border-collapse: collapse !important;vertical-align: top;font-size: 0px;line-height: 0px;mso-line-height-rule: exactly;-ms-text-size-adjust: 100%;-webkit-text-size-adjust: 100%">
          <span>&#160;</span>
        </td>
      </tr>
    </tbody>
  </table>

      </td>
    </tr>
  </tbody>
</table>

<table style="font-family:'Montserrat',sans-serif;" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
  <tbody>
    <tr>
      <td style="overflow-wrap:break-word;word-break:break-word;padding:10px;font-family:'Montserrat',sans-serif;" align="left">
        
  <!--[if mso]><table width="100%"><tr><td><![endif]-->
    <h1 style="margin: 0px; line-height: 140%; text-align: center; word-wrap: break-word; font-family: 'Montserrat',sans-serif; font-size: 22px; font-weight: 700;"><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span>Portfolio Contact</span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></h1>
  <!--[if mso]></td></tr></table><![endif]-->

      </td>
    </tr>
  </tbody>
</table>

<table style="font-family:'Montserrat',sans-serif;" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
  <tbody>
    <tr>
      <td style="overflow-wrap:break-word;word-break:break-word;padding:10px;font-family:'Montserrat',sans-serif;" align="left">
        
  <table height="0px" align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;table-layout: fixed;border-spacing: 0;mso-table-lspace: 0pt;mso-table-rspace: 0pt;vertical-align: top;border-top: 1px solid #0d6efd;-ms-text-size-adjust: 100%;-webkit-text-size-adjust: 100%">
    <tbody>
      <tr style="vertical-align: top">
        <td style="word-break: break-word;border-collapse: collapse !important;vertical-align: top;font-size: 0px;line-height: 0px;mso-line-height-rule: exactly;-ms-text-size-adjust: 100%;-webkit-text-size-adjust: 100%">
          <span>&#160;</span>
        </td>
      </tr>
    </tbody>
  </table>

      </td>
    </tr>
  </tbody>
</table>

  <!--[if (!mso)&(!IE)]><!--></div><!--<![endif]-->
  </div>
</div>
<!--[if (mso)|(IE)]></td><![endif]-->
      <!--[if (mso)|(IE)]></tr></table></td></tr></table><![endif]-->
    </div>
  </div>
  </div>
  


  
  
<div class="u-row-container" style="padding: 0px;background-color: transparent">
  <div class="u-row" style="margin: 0 auto;min-width: 320px;max-width: 500px;overflow-wrap: break-word;word-wrap: break-word;word-break: break-word;background-color: transparent;">
    <div style="border-collapse: collapse;display: table;width: 100%;height: 100%;background-color: transparent;">
      <!--[if (mso)|(IE)]><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding: 0px;background-color: transparent;" align="center"><table cellpadding="0" cellspacing="0" border="0" style="width:500px;"><tr style="background-color: transparent;"><![endif]-->
      
<!--[if (mso)|(IE)]><td align="center" width="166" style="width: 166px;padding: 0px;border-top: 0px solid transparent;border-left: 0px solid transparent;border-right: 0px solid transparent;border-bottom: 0px solid transparent;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;" valign="top"><![endif]-->
<div class="u-col u-col-33p33" style="max-width: 320px;min-width: 166.67px;display: table-cell;vertical-align: top;">
  <div style="height: 100%;width: 100% !important;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;">
  <!--[if (!mso)&(!IE)]><!--><div style="box-sizing: border-box; height: 100%; padding: 0px;border-top: 0px solid transparent;border-left: 0px solid transparent;border-right: 0px solid transparent;border-bottom: 0px solid transparent;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;"><!--<![endif]-->
  
<table style="font-family:'Montserrat',sans-serif;" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
  <tbody>
    <tr>
      <td style="overflow-wrap:break-word;word-break:break-word;padding:10px;font-family:'Montserrat',sans-serif;" align="left">
        
  <!--[if mso]><table width="100%"><tr><td><![endif]-->
    <h2 style="margin: 0px; line-height: 140%; text-align: left; word-wrap: break-word; font-size: 20px; font-weight: 400;"><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span>${name}<br /></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></h2>
  <!--[if mso]></td></tr></table><![endif]-->

      </td>
    </tr>
  </tbody>
</table>

  <!--[if (!mso)&(!IE)]><!--></div><!--<![endif]-->
  </div>
</div>
<!--[if (mso)|(IE)]></td><![endif]-->
<!--[if (mso)|(IE)]><td align="center" width="333" style="width: 333px;padding: 0px;border-top: 0px solid transparent;border-left: 0px solid transparent;border-right: 0px solid transparent;border-bottom: 0px solid transparent;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;" valign="top"><![endif]-->
<div class="u-col u-col-66p67" style="max-width: 320px;min-width: 333.33px;display: table-cell;vertical-align: top;">
  <div style="height: 100%;width: 100% !important;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;">
  <!--[if (!mso)&(!IE)]><!--><div style="box-sizing: border-box; height: 100%; padding: 0px;border-top: 0px solid transparent;border-left: 0px solid transparent;border-right: 0px solid transparent;border-bottom: 0px solid transparent;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;"><!--<![endif]-->
  
<table style="font-family:'Montserrat',sans-serif;" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
  <tbody>
    <tr>
      <td style="overflow-wrap:break-word;word-break:break-word;padding:10px;font-family:'Montserrat',sans-serif;" align="left">
        
  <!--[if mso]><table width="100%"><tr><td><![endif]-->
    <h2 style="margin: 0px; color: #0d6efd; line-height: 140%; text-align: right; word-wrap: break-word; font-size: 20px; font-weight: 400;"><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><a rel="noopener" href="mailto:${email}" target="_blank">${email}</a></span></span></span></span></span></span></span></span><a rel="noopener" href="mailto:${email}" target="_blank"><span><span><span><span><span><span><span><span></span></span></span></span></span></span></span></span></a></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></h2>
  <!--[if mso]></td></tr></table><![endif]-->

      </td>
    </tr>
  </tbody>
</table>

  <!--[if (!mso)&(!IE)]><!--></div><!--<![endif]-->
  </div>
</div>
<!--[if (mso)|(IE)]></td><![endif]-->
      <!--[if (mso)|(IE)]></tr></table></td></tr></table><![endif]-->
    </div>
  </div>
  </div>
  


  
  
<div class="u-row-container" style="padding: 0px;background-color: transparent">
  <div class="u-row" style="margin: 0 auto;min-width: 320px;max-width: 500px;overflow-wrap: break-word;word-wrap: break-word;word-break: break-word;background-color: transparent;">
    <div style="border-collapse: collapse;display: table;width: 100%;height: 100%;background-color: transparent;">
      <!--[if (mso)|(IE)]><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding: 0px;background-color: transparent;" align="center"><table cellpadding="0" cellspacing="0" border="0" style="width:500px;"><tr style="background-color: transparent;"><![endif]-->
      
<!--[if (mso)|(IE)]><td align="center" width="500" style="width: 500px;padding: 0px;border-top: 0px solid transparent;border-left: 0px solid transparent;border-right: 0px solid transparent;border-bottom: 0px solid transparent;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;" valign="top"><![endif]-->
<div class="u-col u-col-100" style="max-width: 320px;min-width: 500px;display: table-cell;vertical-align: top;">
  <div style="height: 100%;width: 100% !important;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;">
  <!--[if (!mso)&(!IE)]><!--><div style="box-sizing: border-box; height: 100%; padding: 0px;border-top: 0px solid transparent;border-left: 0px solid transparent;border-right: 0px solid transparent;border-bottom: 0px solid transparent;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;"><!--<![endif]-->
  
<table style="font-family:'Montserrat',sans-serif;" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
  <tbody>
    <tr>
      <td style="overflow-wrap:break-word;word-break:break-word;padding:10px;font-family:'Montserrat',sans-serif;" align="left">
        
  <table height="0px" align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;table-layout: fixed;border-spacing: 0;mso-table-lspace: 0pt;mso-table-rspace: 0pt;vertical-align: top;border-top: 1px solid #0d6efd;-ms-text-size-adjust: 100%;-webkit-text-size-adjust: 100%">
    <tbody>
      <tr style="vertical-align: top">
        <td style="word-break: break-word;border-collapse: collapse !important;vertical-align: top;font-size: 0px;line-height: 0px;mso-line-height-rule: exactly;-ms-text-size-adjust: 100%;-webkit-text-size-adjust: 100%">
          <span>&#160;</span>
        </td>
      </tr>
    </tbody>
  </table>

      </td>
    </tr>
  </tbody>
</table>

<table style="font-family:'Montserrat',sans-serif;" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
  <tbody>
    <tr>
      <td style="overflow-wrap:break-word;word-break:break-word;padding:10px;font-family:'Montserrat',sans-serif;" align="left">
        
  <!--[if mso]><table width="100%"><tr><td><![endif]-->
    <h1 style="margin: 0px; line-height: 140%; text-align: center; word-wrap: break-word; font-size: 22px; font-weight: 400;"><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span><span>Message</span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></h1>
  <!--[if mso]></td></tr></table><![endif]-->

      </td>
    </tr>
  </tbody>
</table>

  <!--[if (!mso)&(!IE)]><!--></div><!--<![endif]-->
  </div>
</div>
<!--[if (mso)|(IE)]></td><![endif]-->
      <!--[if (mso)|(IE)]></tr></table></td></tr></table><![endif]-->
    </div>
  </div>
  </div>
  


  
  
<div class="u-row-container" style="padding: 0px;background-color: transparent">
  <div class="u-row" style="margin: 0 auto;min-width: 320px;max-width: 500px;overflow-wrap: break-word;word-wrap: break-word;word-break: break-word;background-color: transparent;">
    <div style="border-collapse: collapse;display: table;width: 100%;height: 100%;background-color: transparent;">
      <!--[if (mso)|(IE)]><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding: 0px;background-color: transparent;" align="center"><table cellpadding="0" cellspacing="0" border="0" style="width:500px;"><tr style="background-color: transparent;"><![endif]-->
      
<!--[if (mso)|(IE)]><td align="center" width="500" style="width: 500px;padding: 0px;border-top: 0px solid transparent;border-left: 0px solid transparent;border-right: 0px solid transparent;border-bottom: 0px solid transparent;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;" valign="top"><![endif]-->
<div class="u-col u-col-100" style="max-width: 320px;min-width: 500px;display: table-cell;vertical-align: top;">
  <div style="height: 100%;width: 100% !important;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;">
  <!--[if (!mso)&(!IE)]><!--><div style="box-sizing: border-box; height: 100%; padding: 0px;border-top: 0px solid transparent;border-left: 0px solid transparent;border-right: 0px solid transparent;border-bottom: 0px solid transparent;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;"><!--<![endif]-->
  
<table style="font-family:'Montserrat',sans-serif;" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
  <tbody>
    <tr>
      <td style="overflow-wrap:break-word;word-break:break-word;padding:10px;font-family:'Montserrat',sans-serif;" align="left">
        
  <!--[if mso]><table width="100%"><tr><td><![endif]-->
    <h3 style="margin: 0px; line-height: 140%; text-align: left; word-wrap: break-word; font-size: 18px; font-weight: 400;"><span><span><span><span><span><span><span><span><span><span>${subject}</span></span></span></span></span></span></span></span></span></span></h3>
  <!--[if mso]></td></tr></table><![endif]-->

      </td>
    </tr>
  </tbody>
</table>

<table style="font-family:'Montserrat',sans-serif;" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
  <tbody>
    <tr>
      <td style="overflow-wrap:break-word;word-break:break-word;padding:10px;font-family:'Montserrat',sans-serif;" align="left">
        
  <div style="font-size: 14px; line-height: 140%; text-align: left; word-wrap: break-word;">
    <p style="line-height: 140%;">${message}</p>
  </div>

      </td>
    </tr>
  </tbody>
</table>

<table style="font-family:'Montserrat',sans-serif;" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
  <tbody>
    <tr>
      <td style="overflow-wrap:break-word;word-break:break-word;padding:10px;font-family:'Montserrat',sans-serif;" align="left">
        
  <table height="0px" align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;table-layout: fixed;border-spacing: 0;mso-table-lspace: 0pt;mso-table-rspace: 0pt;vertical-align: top;border-top: 10px solid #0d6efd;-ms-text-size-adjust: 100%;-webkit-text-size-adjust: 100%">
    <tbody>
      <tr style="vertical-align: top">
        <td style="word-break: break-word;border-collapse: collapse !important;vertical-align: top;font-size: 0px;line-height: 0px;mso-line-height-rule: exactly;-ms-text-size-adjust: 100%;-webkit-text-size-adjust: 100%">
          <span>&#160;</span>
        </td>
      </tr>
    </tbody>
  </table>

      </td>
    </tr>
  </tbody>
</table>

  <!--[if (!mso)&(!IE)]><!--></div><!--<![endif]-->
  </div>
</div>
<!--[if (mso)|(IE)]></td><![endif]-->
      <!--[if (mso)|(IE)]></tr></table></td></tr></table><![endif]-->
    </div>
  </div>
  </div>
  


    <!--[if (mso)|(IE)]></td></tr></table><![endif]-->
    </td>
  </tr>
  </tbody>
  </table>
  <!--[if mso]></div><![endif]-->
  <!--[if IE]></div><![endif]-->
</body>

</html>

  `;
}
