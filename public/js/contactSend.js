const sendContactButton = document.getElementById('sendContactButton')
function formSubmitContact(event) {
  event.preventDefault()
  let contactFormData = {}
  let contactFormInputs = document.querySelectorAll('#contactForm input')
  contactFormInputs.forEach((input) => {
    contactFormData[input.name] = input.value
  })
  contactFormData['message'] = document.querySelector('#msgArea').value
  document.getElementById('contactFieldset').disabled = true
  sendContactButton.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>'
  let request = new XMLHttpRequest()
  request.open('POST', '/api/contact', true)
  request.onload = function () {
    if (request.readyState === 4 && request.status === 200) {
      sendContactButton.setAttribute('class', 'btn btn-success w-100')
      sendContactButton.innerHTML = '<span><i class="fa-solid fa-check"></i></span> Message sent successfully<br>Thank you for reaching out!'
    } else if (request.status === 413) {
      sendContactButton.innerHTML = '<span><i class="fa-solid fa-triangle-exclamation"></i></span> Message too long<br>Ensure your message is less than 1000 characters'
      sendContactButton.setAttribute('class', 'btn btn-danger w-100')
    } else {
      sendContactButton.innerHTML = '<span><i class="fa-solid fa-triangle-exclamation"></i></span> Failed to send message<br>Try again later or email me directly at philip@philipwhite.dev'
      sendContactButton.setAttribute('class', 'btn btn-danger w-100')
    }
  }
  request.setRequestHeader('Content-Type', 'application/json')
  request.send(JSON.stringify(contactFormData))
}

const forms = document.querySelectorAll('.needs-validation')
Array.from(forms).forEach((form) => {
  form.addEventListener(
    'submit',
    (event) => {
      if (!form.checkValidity()) {
        event.preventDefault()
        event.stopPropagation()
      } else {
        formSubmitContact(event)
      }

      form.classList.add('was-validated')
    },
    false
  )
})
