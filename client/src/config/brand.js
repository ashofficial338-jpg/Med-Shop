// Gugan Medicals: one place for the brand name and the public website's
// content. Edit this file to update the homepage. Blank fields are hidden
// rather than shown empty.

export const BRAND = {
  name: "Gugan Medicals",
  short: "Gugan",
  tagline: "Trusted care, every day",
  description:
    "Gugan Medicals is your neighbourhood pharmacy for genuine medicines, healthcare essentials and friendly, expert advice.",
};

// Shown in the homepage Contact section and footer. Fill these in with the
// shop's real details. Anything left blank is simply not displayed.
export const CONTACT = {
  phone: "", // e.g. "+91 98765 43210"
  whatsapp: "", // digits only with country code, e.g. "919876543210"
  email: "",
  addressLine1: "", // e.g. "12 Main Street"
  addressLine2: "", // e.g. "Chennai 600001"
  mapUrl: "", // a Google Maps share link
  hours: [
    { days: "Monday – Saturday", time: "8:00 AM – 10:00 PM" },
    { days: "Sunday", time: "9:00 AM – 1:00 PM" },
  ],
};

// Customer testimonials for the homepage. Add real quotes from real
// customers (with their permission). The section stays hidden while this
// list is empty, so the live site never shows made-up reviews.
//   { quote: "…", name: "Customer name", detail: "Regular customer since 2021" }
export const TESTIMONIALS = [];
