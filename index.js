#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const fetch = require('node-fetch')
const XML = require('xml2js')
const translate = require('@vitalets/google-translate-api')
const nodemailer = require('nodemailer')

const dictionary = require(path.join(__dirname, 'dictionary.json'))
require('dotenv').config({ path: path.resolve(__dirname, '.env') })

const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8')

const OPTIONS = Object.freeze({
  verbose: process.env.VERBOSE,
  url: process.env.FEED,
  translation: { to: 'fr' },
  mail: {
    subject: '🐔',
    from: `titre_de_pornos <${(process.env.MAILTO || '').split(',').shift()}>`,
    to: process.env.MAILTO
  },
  transport: {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  }
})

;(async () => {
  try {
    OPTIONS.verbose && console.log('Fetching RSS…')
    const res = await fetch(OPTIONS.url)

    OPTIONS.verbose && console.log('Converting to XML…')
    const xml = await res.text()

    OPTIONS.verbose && console.log('Parsing XML…')
    const parser = new XML.Parser()
    const obj = await parser.parseStringPromise(xml)
    const titles = obj.rss.channel[0].item.map(({ title }) => title[0])

    OPTIONS.verbose && console.log('Translating titles…')
    const translations = await Promise.all(titles.map(computeTranslation))

    if (!OPTIONS.mail.to) {
      console.log('No MAILTO defined, outputing titles instead:\n')
      console.log(translations.join('\n'))
      return
    }

    OPTIONS.verbose && console.log('Sending mail…')
    const pattern = template.match(/{{ translation }}((.|\n)*){{ \/translation }}/gm)[0]
    const transporter = nodemailer.createTransport(OPTIONS.transport)
    const mail = await transporter.sendMail(Object.assign({}, OPTIONS.mail, {
      text: translations.join('\n'),
      html: template
        .replace(pattern, translations.map(t => (
          pattern
            .replace(/{{ content }}/g, t)
            .replace(/{{ content_encoded }}/g, encodeURI(t))
        )).join('\n'))
        .replace(/{{ translation }}/g, '')
        .replace(/{{ \/translation }}/g, '')
    }))

    if (mail.rejected.length) throw new Error(mail.rejected)
    OPTIONS.verbose && console.log('Mail successfully sent !')
    OPTIONS.verbose && console.log(mail)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
})()

async function computeTranslation (title) {
  // This seems to help Google translate identify more common translatable words
  title = title.toLowerCase()

  let { text: translation } = await translate(title, OPTIONS.translation)

  // Force-translate specific words defined in an external dictionary
  for (const ref in dictionary) {
    const re = new RegExp(ref, 'gi')
    const word = Array.isArray(dictionary[ref])
      ? dictionary[ref][Math.floor(Math.random() * dictionary[ref].length)]
      : dictionary[ref]
    translation = translation.replace(re, word)
  }

  return translation
}
