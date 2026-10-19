// Original HEC question keys/options, plus staff supply and usage details.
export const HEC_FIELDS = [
  {
    "key": "people",
    "label": "People living here",
    "type": "select",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5+"
    ]
  },
  {
    "key": "homeType",
    "label": "Home type",
    "type": "select",
    "options": [
      "House",
      "Apartment / unit",
      "Other"
    ]
  },
  {
    "key": "dayHome",
    "label": "Home during daytime",
    "type": "select",
    "options": [
      "Usually someone home",
      "Home some days",
      "Usually empty during working hours",
      "It varies"
    ]
  },
  {
    "key": "workFromHome",
    "label": "Work from home",
    "type": "select",
    "options": [
      "Yes",
      "Sometimes",
      "No"
    ]
  },
  {
    "key": "loadTiming",
    "label": "When electricity use is highest",
    "type": "select",
    "options": [
      "Mostly daytime",
      "Mostly evening",
      "Spread through the day",
      "Not sure"
    ]
  },
  {
    "key": "hotWater",
    "label": "Hot-water heating",
    "type": "select",
    "options": [
      "Electric hot-water cylinder",
      "Heat-pump hot water",
      "Solar hot water",
      "Gas",
      "Other / not sure"
    ]
  },
  {
    "key": "cylinderSize",
    "label": "Cylinder size",
    "type": "select",
    "options": [
      "Under 180 litres",
      "180–250 litres",
      "Over 250 litres"
    ],
    "condition": {
      "key": "hotWater",
      "values": [
        "Electric hot-water cylinder",
        "Solar hot water"
      ]
    }
  },
  {
    "key": "hotWaterControl",
    "label": "Controlled / ripple hot water",
    "type": "select",
    "options": [
      "Yes",
      "No"
    ],
    "condition": {
      "key": "hotWater",
      "values": [
        "Electric hot-water cylinder",
        "Solar hot water"
      ]
    }
  },
  {
    "key": "cylinderCondition",
    "label": "Cylinder condition",
    "type": "select",
    "options": [
      "Working well",
      "Older but serviceable",
      "Likely to need replacement"
    ],
    "condition": {
      "key": "hotWater",
      "values": [
        "Electric hot-water cylinder",
        "Solar hot water"
      ]
    }
  },
  {
    "key": "loads",
    "label": "Electrical loads",
    "type": "multi",
    "options": [
      "EV",
      "Pool",
      "Spa",
      "Clothes dryer",
      "Washing machine",
      "Dishwasher",
      "Electric cooking",
      "Heat pump / electric heating",
      "Water pump",
      "Other"
    ]
  },
  {
    "key": "evDayHome",
    "label": "EV home during solar hours",
    "type": "select",
    "options": [
      "Usually",
      "Sometimes",
      "Rarely"
    ],
    "condition": {
      "key": "loads",
      "values": [
        "EV"
      ]
    }
  },
  {
    "key": "goals",
    "label": "Solar goals",
    "type": "multi",
    "options": [
      "Lower my power bills",
      "Use more of my own clean energy",
      "Reduce reliance on the grid",
      "Battery backup during outages",
      "Charge an EV from solar",
      "Prepare for future energy needs"
    ]
  },
  {
    "key": "existingSolar",
    "label": "Existing solar",
    "type": "select",
    "options": [
      "No existing solar",
      "Solar already installed",
      "Solar and battery already installed",
      "Not sure"
    ]
  },
  {
    "key": "batteryInterest",
    "label": "Battery preference",
    "type": "select",
    "options": [
      "Open to advice",
      "Interested if the numbers support it",
      "Backup power is important",
      "Prefer solar without a battery",
      "Not sure"
    ]
  },
  {
    "key": "plannedChanges",
    "label": "Planned changes",
    "type": "multi",
    "options": [
      "EV or another EV",
      "Hot-water heat pump",
      "More electric heating",
      "Pool or spa",
      "Home extension or more occupants",
      "No major changes planned"
    ]
  },
  {
    "key": "roof",
    "label": "Roof type",
    "type": "select",
    "options": [
      "Metal / corrugated",
      "Tile",
      "Flat / membrane",
      "Other",
      "I don’t know"
    ]
  },
  {
    "key": "direction",
    "label": "Roof direction",
    "type": "select",
    "options": [
      "North",
      "East",
      "West",
      "Several directions",
      "I don’t know"
    ]
  },
  {
    "key": "shade",
    "label": "Shading",
    "type": "select",
    "options": [
      "Very little",
      "Some",
      "A lot",
      "I don’t know"
    ]
  },
  {
    "key": "householdPersona",
    "label": "Starting household profile",
    "type": "select",
    "options": [
      "just-us",
      "busy-family",
      "home-in-day",
      "lots-going-on",
      "something-different"
    ]
  },
  {
    "key": "name",
    "label": "Customer name",
    "type": "text"
  },
  {
    "key": "email",
    "label": "Email",
    "type": "text"
  },
  {
    "key": "phone",
    "label": "Phone",
    "type": "text"
  },
  {
    "key": "address",
    "label": "Property address",
    "type": "text"
  },
  {
    "key": "retailer",
    "label": "Electricity retailer",
    "type": "text"
  },
  {
    "key": "plan_name",
    "label": "Tariff / plan name",
    "type": "text"
  },
  {
    "key": "tariff_description",
    "label": "Tariff arrangements",
    "type": "text"
  },
  {
    "key": "icp",
    "label": "ICP (15 characters)",
    "type": "text"
  },
  {
    "key": "meter_number",
    "label": "Meter number",
    "type": "text"
  },
  {
    "key": "meter_type",
    "label": "Meter type / configuration",
    "type": "text"
  },
  {
    "key": "meter_notes",
    "label": "Meter / controlled-load notes",
    "type": "text"
  },
  {
    "key": "network",
    "label": "Electricity network",
    "type": "text"
  },
  {
    "key": "annual_kwh",
    "label": "Confirmed annual consumption (kWh)",
    "type": "number"
  },
  {
    "key": "annual_cost_nzd",
    "label": "Confirmed annual electricity costs ($)",
    "type": "number"
  },
  {
    "key": "energy_notes",
    "label": "Other energy / HEC notes",
    "type": "text"
  }
];
