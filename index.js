const express = require('express');
const cors = require('cors');
require('dotenv').config()
const jwt = require('jsonwebtoken');
const nodemailer = require("nodemailer");
const mg = require('nodemailer-mailgun-transport');

const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY);

const app = express()
const port = process.env.PORT || 5000;

// middleware 
app.use(cors())
app.use(express.json())

// send email for confirmation mail
// let transporter = nodemailer.createTransport({
//     host: 'smtp.sendgrid.net',
//     port: 587,
//     auth: {
//         user: "apikey",
//         pass: process.env.SENDGRID_API_KEY
//     }
//  })

const auth = {
    auth: {
        api_key: process.env.EMAIL_PRIVATE_KEY,
        domain: process.env.EMAIL_DOMAIN
    }
}

const transporter = nodemailer.createTransport(mg(auth));


const sentMailConfirmationEmail = (payment) => {
    transporter.sendMail({
        from: "billalcoom@gmail.com", // verified sender email
        to: "billalcoom@gmail.com", // recipient email
        subject: "Your order is confirmed. Enjoy the Food soon", // Subject line
        text: "Hello world!", // plain text body
        html: `
        <div>
            <h2>Payment confirmed </h2>
            <p>Payment Transaction Id ${payment.transactionId}</p>
        </div>
        `, // html body
    }, function (error, info) {
        if (error) {
            console.log(error);
        } else {
            console.log('Email sent: ' + info.response);
        }
    });


}




const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'Unauthorize Access' })
    }

    const token = authorization.split(' ')[1]

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'Unauthorize Access' })
        }
        req.decoded = decoded;
        next()
    })
}







const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vxlatcb.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});




async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const menuCollection = client.db("bistroDb").collection('menu');
        const usersCollection = client.db("bistroDb").collection('users');
        const reviewsCollection = client.db("bistroDb").collection('reviews');
        const cartCollection = client.db("bistroDb").collection('carts');
        const paymentsCollection = client.db("bistroDb").collection('payments');

        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '7d' })

            res.send(token)
        })

        // warning : use verifyJWT before using verifyAdmin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query)
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden message' })
            }
            next()
        }



        // users related api
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await usersCollection.findOne(query)
            if (existingUser) {
                return res.send({ message: 'user has already existed' })
            }
            const result = await usersCollection.insertOne(user)
            res.send(result)
        })

        // security first layer verifyJWT use
        // second layer decoded email and user email check
        // check admin

        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                return res.send({ admin: false })
            }

            const query = { email: email }
            const user = await usersCollection.findOne(query)
            const result = { admin: user?.role === 'admin' }
            res.send(result)
        })

        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id
            console.log(id)
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc)
            res.send(result)
        })

        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray()
            res.send(result)
        })



        // menu related
        app.get('/menu', async (req, res) => {
            const result = await menuCollection.find().toArray()
            res.send(result)
        })

        app.post('/menu', verifyJWT, verifyAdmin, async (req, res) => {
            const newItem = req.body;
            const result = await menuCollection.insertOne(newItem)
            res.send(result)
        })

        app.delete('/menu/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await menuCollection.deleteOne(query);
            res.send(result)
        })


        // review related api
        app.get('/reviews', async (req, res) => {
            const result = await reviewsCollection.find().toArray()
            res.send(result)
        })

        // cart collection api

        app.post('/carts', async (req, res) => {
            const item = req.body;
            const result = await cartCollection.insertOne(item);
            res.send(result)
        })

        app.get('/carts', verifyJWT, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                return res.send([])
            }

            const decodedEmail = req.decoded.email
            if (email !== decodedEmail) {
                return res.status(403).send({ err: true, message: 'forbiden Access' })
            }

            const query = { email: email };
            const result = await cartCollection.find(query).toArray()
            res.send(result)
        })

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.send(result)
        })




        // create payment intent 
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            })
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })


        //payment related api
        app.post('/payments', verifyJWT, async (req, res) => {
            const payment = req.body;
            const insertedResult = await paymentsCollection.insertOne(payment);

            const query = { _id: { $in: payment.cartItems.map(id => new ObjectId(id)) } }
            const deleteResult = await cartCollection.deleteMany(query)

            //send an email confirming payment
            console.log(payment)
            sentMailConfirmationEmail(payment)


            res.send({ insertedResult, deleteResult })
        })


        app.get('/admin-stats', verifyJWT, verifyAdmin, async (req, res) => {
            const users = await usersCollection.estimatedDocumentCount();
            const products = await menuCollection.estimatedDocumentCount();
            const orders = await paymentsCollection.estimatedDocumentCount();
            const payments = await paymentsCollection.find().toArray();
            const revenue = payments.reduce((sum, payment) => sum + payment.price, 0);

            res.send({
                users,
                products,
                orders,
                revenue

            })
        })

        /*
       ------------
       bangla system (second best solution)
       ------------------------
       1.load all payments
       2.for each payment , get the menu items array
       3 . for each item in the menu items array get the menu item form the menu collection
       4. put then in an array : all ordered items
       5. separate all ordered items by category using filter 
       6. now get the quantity using the length
       7. for total amount use reduce 
       */
        // const pipeline = [
        //     {
        //         $lookup: {
        //             from: 'menu',
        //             localField: 'menuItems',
        //             foreignField: '_id',
        //             as: 'menuItemsData',
        //         },
        //     },
        //     {
        //         $unwind: '$menuItemsData',
        //     },
        //     {
        //         $group: {
        //             _id: '$menuItemsData.category',
        //             count: { $sum: 1 },
        //             totalPrice: { $sum: '$menuItemsData.price' },
        //         },
        //     },
        // ];

        app.get('/order-stats', verifyJWT, verifyAdmin, async (req, res) => {

            const pipeline = [
                {
                    $lookup: {
                        from: 'menu',
                        localField: 'menuItems',
                        foreignField: '_id',
                        as: 'menuItemsData',
                    },
                },
                {
                    $unwind: '$menuItemsData',
                },
                {
                    $group: {
                        _id: '$menuItemsData.category',
                        count: { $sum: 1 },
                        total: { $sum: '$menuItemsData.price' },
                    },
                },
                {
                    $project: {
                        category: '$_id',
                        count: 1,
                        total: { $round: ['$total', 2] },
                        _id: 0,
                    },
                },
                //    {
                //     $lookup: {
                //         from: 'menu',
                //         localField: 'menuItems',
                //         foreignField: 'id',
                //         as: 'menuItemsData',
                //     },
                // },
                // {
                //     $unwind: '$menuItemsData',
                // },
                // {
                //     $group: {
                //         _id: '$menuItemsData.category',
                //         count: { $sum: 1 },
                //         totalPrice: { $sum: '$menuItemsData.price' },
                //     },
                // },
            ];

            const result = await paymentsCollection.aggregate(pipeline).toArray()
            res.send(result)

        })




        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);







app.get('/', (req, res) => {
    res.send('Bistro Boss Is Running')
})

app.listen(port, () => {
    console.log(`bistro server is running port is ${port}`)
})