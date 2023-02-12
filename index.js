const express = require("express");
require("dotenv").config();
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { query } = require("express");
const ObjectId = require("mongodb").ObjectId;
const jwt = require("jsonwebtoken");
const app = express();
const port = process.env.PORT;
const stripe = require("stripe")(process.env.STRIPE_SK);

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.h6ly4.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send("unauthorized ");
  }

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send("forbidden access");
    }
    req.decoded = decoded;
    next();
  });
}

async function run() {
  try {
    client.connect();
    const database = client.db("the-look");
    const serviceCollection = database.collection("services");
    const bookingCollection = database.collection("booking");
    const userCollection = database.collection("users");
    const barberCollection = database.collection("barber");
    const paymentCollection = database.collection("payment");

    // note: make sure that use admin verify middleware into the run function and  after verify jwt 
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const email = { email: decodedEmail };
      const user = await userCollection.findOne(email);

      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next()
    }

    app.get("/services", async (req, res) => {
      const date = req.query.date;
      const options = await serviceCollection.find({}).toArray();
      const bookingQuery = { date: date };
      const alreadyBooking = await bookingCollection
        .find(bookingQuery)
        .toArray();
      options.forEach((option) => {
        const optionBook = alreadyBooking.filter((book) => book.serviceName === option.name);
        const bookSlots = optionBook.map((book) => book.slot);
        const remainingSlots = option.slots.filter(
          (slot) => !bookSlots.includes(slot)
        );
        option.slots = remainingSlots;
      });
      res.send(options);
    });

    app.get("/services/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await serviceCollection.findOne(filter);
      res.send(result);
    });

    app.post("/booking", async (req, res) => {
      const booking = req.body;

      const query = {
        date: booking?.date,
        email: booking?.email,
        serviceName: booking?.serviceName,
      };

      const alreadyBooked = await bookingCollection.find(query).toArray();

      if (alreadyBooked?.length) {
        const message = `already have a booking on ${booking.date}`;
        return res.send({ acknowledged: false, message });
      }

      const result = await bookingCollection.insertOne(booking);
      return res.send(result);
    });

    app.get("/booking", verifyJWT,  async (req, res) => {
      const email = req.query.email;

      const query = { email: email };
      const booking = await bookingCollection.find(query).toArray();
      res.send(booking);
    });

    app.get('/booking/:id', verifyJWT,  async(req, res) => {
      const id = req.params.id;
      const query = {_id: new ObjectId(id)};
      const result = await bookingCollection.findOne(query)
      res.send(result)
    })

    app.post("/users", async (req, res) => {
      const user = req.body;
      const email = user.email;
      const emailQuery = { email: email };
      const alreadyUser = await userCollection.find(emailQuery).toArray();

      if (alreadyUser.length) {
        return res.send({ acknowledged: false });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users", verifyJWT, verifyAdmin,  async (req, res) => {
      const query = {};
      const result = await userCollection.find(query).toArray();
      res.send(result);
    });


    app.get("/user/admin/:email",  async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);

      res.send({ isAdmin: user?.role === "admin" });
    });

    app.put("/user/admin/:id", verifyJWT, verifyAdmin,  async (req, res) => {
     
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };

      const result = await userCollection.updateOne(filter, updateDoc, options);
      res.send(result);
    });

    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {
          expiresIn: "1hr",
        });
        return res.send({ accessToken: token });
      }
    });



    app.get('/serviceSpecialty',  async(req, res) => {
      const query = {}
      const result = await serviceCollection.find(query).project({name: 1}).toArray() 
      res.send(result)
    })


    app.post('/barber', async(req, res) => {
    const barber = req.body;
    
    const result = await barberCollection.insertOne(barber)
    res.send(result)
    })


    app.get('/barber', verifyJWT, verifyAdmin,  async(req, res) => {
      const query = {};
      const result = await barberCollection.find(query).toArray()
      res.send(result)
    })


    app.delete('/barber/:id',   async(req, res) => {

      const id = req.params.id;
      const filter = {_id: new ObjectId(id)};
      const result = await barberCollection.deleteOne(filter);
      res.send(result)


    })




    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 1000;
    
      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        
        currency: "usd",
        amount: amount,
        "payment_method_types": [
          "card"
        ]
      });
    
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });



    app.post('/payment', async(req, res) => {
      const booking = req.body;
      const id = booking.bookingId
      const result = await paymentCollection.insertOne(booking)
      const filter = {_id: new ObjectId(id)}
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: booking.transactionId 
        }
      }
      const updatedResult = await bookingCollection.updateOne(filter, updatedDoc)


      res.send(result)
    })
   

  } finally {
    //   await client.close();
  }
}



run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
