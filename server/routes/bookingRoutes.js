import express from 'express';
import { createBooking, getOccuoiedSeats } from '../controllers/bookingController.js';

const bookingRouter = express.Router();

bookingRouter.post('/create',createBooking);
bookingRouter.get('/seats/:showId',getOccuoiedSeats);

export default bookingRouter;