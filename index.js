require("dotenv").config();
import stripe from "stripe";

const client = stripe(process.env.STRIPE_SK);

var euList = [
  { country: "Austria", code: "AT", vat: 20 },
  { country: "Belgium", code: "BE", vat: 21 },
  { country: "Bulgaria", code: "BG", vat: 20 },
  { country: "Croatia", code: "HR", vat: 25 },
  { country: "Cyprus", code: "CY", vat: 19 },
  { country: "Czech Republic", code: "CZ", vat: 21 },
  { country: "Denmark", code: "DK", vat: 25 },
  { country: "Estonia", code: "EE", vat: 20 },
  { country: "Finland", code: "FI", vat: 24 },
  { country: "France", code: "FR", vat: 20 },
  { country: "Germany", code: "DE", vat: 19 },
  { country: "Greece", code: "GR", vat: 24 },
  { country: "Hungary", code: "HU", vat: 27 },
  { country: "Ireland", code: "IE", vat: 23 },
  { country: "Italy", code: "IT", vat: 22 },
  { country: "Latvia", code: "LV", vat: 21 },
  { country: "Lithuania", code: "LT", vat: 21 },
  { country: "Luxembourg", code: "LU", vat: 17 },
  { country: "Malta", code: "MT", vat: 18 },
  { country: "Netherlands", code: "NL", vat: 21 },
  { country: "Poland", code: "PL", vat: 23 },
  { country: "Portugal", code: "PT", vat: 23 },
  { country: "Romania", code: "RO", vat: 20 },
  { country: "Slovakia", code: "SK", vat: 20 },
  { country: "Slovenia", code: "SI", vat: 22 },
  { country: "Spain", code: "ES", vat: 21 },
  { country: "Sweden", code: "SE", vat: 25 },
  { country: "United Kingdom", code: "GB", vat: 20 }
];

// last month
// 2019/02/28 12:46:25
// 2019/01/31 22:06:17
const start = new Date(Date.UTC(2019, 7, 31, 22, 0, 0));
const end = new Date(Date.UTC(2019, 8, 30, 22, 0, 0));

console.log(
  `getting invoices between ${start.toUTCString()} and ${end.toUTCString()}`
);

async function getInvoices(startingAfter) {
  let query = {
    date: {
      gte: Math.floor(+new Date(start) / 1000),
      lte: Math.floor(+new Date(end) / 1000)
    },
    limit: 10
  };
  if (startingAfter) {
    query = {
      ...query,
      starting_after: startingAfter
    };
  }
  const invoices = await client.invoices.list(query);
  console.log(`got ${invoices.data.length} invoices`);
  return invoices;
}

async function getBalanceTransaction(id) {
  return client.balance.retrieveTransaction(id);
}

async function getCharges(startingAfter) {
  let query = {
    created: {
      gte: Math.floor(+new Date(start) / 1000),
      lte: Math.floor(+new Date(end) / 1000)
    },
    limit: 10
  };
  if (startingAfter) {
    query = {
      ...query,
      starting_after: startingAfter
    };
  }
  const charges = await client.charges.list(query);
  // console.log(`got ${charges.data.length} charges`);
  return charges;
}
async function dothething() {
  let invoices = [];
  let hasMore = true;
  while (hasMore) {
    const startingAfter = invoices.length
      ? invoices[invoices.length - 1].id
      : null;
    const { data, has_more } = await getCharges(startingAfter);
    invoices = [...invoices, ...data.filter(inv => inv.status === "succeeded")];
    hasMore = has_more;
  }

  console.log("total", invoices.length);
  return parseCharges(invoices.filter(c => c.balance_transaction));
}

function parseInvoices(invoices) {
  return Promise.all(invoices.map(invoice => parseInvoice(invoice)));
}

async function parseInvoice(invoice) {
  const { customer } = invoice;
  const cust = await client.customers.retrieve(customer);
  const pdf = invoice.invoice_pdf;
  const bankRef = cust.sources.data[0].id;
  const amount = invoice.amount_due;
  const charge = invoice.charge;
  const date = invoice.period_start;
  const number = invoice.number;
  const address = cust.shipping.address;
  return {
    number,
    date,
    pdf,
    bankRef,
    charge,
    amount,
    address
  };
}

function parseCharges(charges) {
  return Promise.all(charges.map(charge => parseCharge(charge)));
}

async function parseCharge(charge) {
  if (charge.status !== "succeeded") {
    return null;
  }
  const tx = await getBalanceTransaction(charge.balance_transaction);
  const { customer, amount } = charge;
  const cust = await client.customers.retrieve(customer);
  const address = cust.shipping ? cust.shipping.address : cust.address;
  const { exchange_rate, fee, net, amount: txAmount } = tx;
  return {
    amountUSD: charge.amount,
    amountEUR: txAmount,
    exchange_rate,
    fee,
    net,
    address
  };
}

(async () => {
  const charges = await dothething();
  charges.sort((a, b) => {
    return a.date - b.date;
  });
  let totalNetEUR = 0;
  let totalGrossEUR = 0;
  let totalGrossUSD = 0;

  const o = charges
    .filter(c => c)
    .reduce((o, c) => {
      const { address, net, amountEUR, amountUSD } = c;
      const { country } = address;
      const hasCountry = o[country];
      const euCountry = euList.find(ei => {
        return ei.country === country || ei.code === country;
      });
      let countryLabel;
      totalNetEUR = totalNetEUR + net;
      totalGrossEUR = totalGrossEUR + amountEUR;
      totalGrossUSD = totalGrossUSD + amountUSD;

      if (!euCountry) {
        countryLabel = "Non-EU";
      } else {
        countryLabel = euCountry.country;
      }
      let out = o;

      if (!o[countryLabel]) {
        out = {
          ...out,
          [countryLabel]: {
            netEUR: 0,
            grossEUR: 0,
            grossUSD: 0
          }
        };
      }
      return {
        ...out,
        [countryLabel]: {
          netEUR: out[countryLabel].netEUR + net,
          grossEUR: out[countryLabel].grossEUR + amountEUR,
          grossUSD: out[countryLabel].grossUSD + amountUSD
        }
      };
    }, {});
  console.log(`Country, Net EUR, Gross EUR, Gross USD`);
  Object.keys(o).forEach(country => {
    console.log(
      `${country}, ${o[country].netEUR / 100}, ${o[country].grossEUR /
        100}, ${o[country].grossUSD / 100}`
    );
  });
  console.log(
    `\nTotal, ${totalNetEUR / 100}, ${totalGrossEUR / 100}, ${totalGrossUSD /
      100}`
  );

  console.log(
    `Stripe Query: https://dashboard.stripe.com/payments?status[]=successful&created[gte]=${start /
      1000}&created[lte]=${end / 1000}`
  );
})();
