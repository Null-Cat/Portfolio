window.addEventListener('load', () => {
  if (window.location.hash) {
    const element = document.querySelector(window.location.hash)
    element.scrollIntoView({ behavior: 'smooth' })
  }
})
