const nodemailer = require('nodemailer');
const pug = require('pug');
const { convert } = require('html-to-text');

const appName = process.env.APP_NAME || 'API';

module.exports = class Email {
  constructor(user, url) {
    this.to = user.email;
    this.firstName = user.name.split(' ')[0];
    this.url = url;
    this.from = `${appName} <${process.env.EMAIL_FROM}>`;
  }

  newTransport() {
    const port = Number(process.env.EMAIL_PORT);

    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port,
      secure: port === 465,
      // Fora de desenvolvimento, nem credenciais nem tokens passam sem TLS
      requireTLS: process.env.NODE_ENV !== 'development',
      auth: process.env.EMAIL_USERNAME
        ? {
            user: process.env.EMAIL_USERNAME,
            pass: process.env.EMAIL_PASSWORD
          }
        : undefined
    });
  }

  // Send the actual email
  async send(template, subject) {
    // 1) Render HTML based on a pug template
    const html = pug.renderFile(`${__dirname}/../views/email/${template}.pug`, {
      firstName: this.firstName,
      url: this.url,
      subject,
      appName
    });

    // 2) Define email options
    const mailOptions = {
      from: this.from,
      to: this.to,
      subject,
      html,
      text: convert(html)
    };

    // 3) Create a transport and send email
    await this.newTransport().sendMail(mailOptions);
  }

  async sendWelcome() {
    await this.send('welcome', `Welcome to ${appName}!`);
  }

  async sendPasswordReset() {
    await this.send(
      'passwordReset',
      'Your password reset token (valid for only 10 minutes)'
    );
  }
};
