import { Inngest } from "inngest";
import User from "../models/User.js";
import Booking from "../models/Booking.js";
import Show from "../models/Show.js";
import sendEmail from "../configs/nodeMailer.js";

// Create a client to send and receive events
export const inngest = new Inngest({ id: "movie-py" });

// Inngest Function to save user data to a database

const syncUserCreation = inngest.createFunction(
  { id: "sync-user-from-clerk" },
  { event: "clerk/user.created" },
  async ({ event }) => {
    const { id, first_name, last_name, email_addresses, image_url } =
      event.data;
    const userData = {
      _id: id,
      email: email_addresses[0].email_address,
      name: first_name + " " + last_name,
      image: image_url,
    };

    await User.create(userData);
  }
);

// Inngest Function to delete user data from database

const syncUserDeletion = inngest.createFunction(
  { id: "delete-user-with-clerk" },
  { event: "clerk/user.deleted" },
  async ({ event }) => {
    const { id } = event.data;

    await User.findByIdAndDelete(id);
  }
);

// Inngest Function to update user data in database

const syncUserUpdation = inngest.createFunction(
  { id: "update-user-with-clerk" },
  { event: "clerk/user.updated" },
  async ({ event }) => {
    const { id, first_name, last_name, email_addresses, image_url } =
      event.data;
    const userData = {
      _id: id,
      email: email_addresses[0].email_address,
      name: first_name + " " + last_name,
      image: image_url,
    };

    await User.findByIdAndUpdate(id, userData);
  }
);

// Inngest Function to cancel booking and release seats of show after 10 minutes of booking created if payment is not made

const releaseSeatsAndDeleteBooking = inngest.createFunction(
  { id: "release-seats-delete-booking" },
  { event: "app/checkpayment" },
  async ({ event, step }) => {
    const tenMinutesLater = new Date(Date.now() + 10 * 60 * 1000);
    await step.sleepUntil("wait-for-10-minutes", tenMinutesLater);

    await step.run("check-payment-status", async () => {
      const bookingId = event.data.bookingId;
      const booking = await Booking.findById(bookingId);

      // If payment is not made, release seats and delete booking
      if (!booking.isPaid) {
        const show = await Show.findById(booking.show);
        booking.bookedSeats.forEach((seat) => {
          delete show.occupiedSeats[seat];
        });
        show.markModified("occupiedSeats");
        await show.save();
        await Booking.findByIdAndDelete(booking._id);
      }
    });
  }
);

// Inngest function to send email when user books a show

const sendBookingConfirmationEmail = inngest.createFunction(
  { id: "send-booking-confirmation-email" },
  { event: "app/show.booked" },
  async ({ event, step }) => {
    const { bookingId } = event.data;
    const booking = await Booking.findById(bookingId)
      .populate({
        path: "show",
        populate: { path: "movie", model: "Movie" },
      })
      .populate("user");

    await sendEmail({
      to: booking.user.email,
      subject: `Payment Confirmation : "${booking.show.movie.title}" booked! `,
      body: `
        <div style="font-family: Arial, sans-serif; line-height:1.5;">
            <h2>Hi ${booking.user.name},</h2>
            <p>Your booking for <strong style="color: #F84565;">"${
              booking.show.movie.title
            }"</strong> is confirmed.</p>
            <p>
                <strong>Date : </strong>${new Date(
                  booking.show.showDateTime
                ).toLocaleDateString("en-US", {
                  timeZone: "Asia/Kolkata",
                })}<br/>
                <strong>Time : </strong>${new Date(
                  booking.show.showDateTime
                ).toLocaleTimeString("en-US", { timeZone: "Asia/Kolkata" })}
            </p>
            <p>Enjoy to show!</p>
            <p>Thanks for booking with us!<br>- Movie.py Team</p>
        </div>
      `,
    });
  }
);

// Inngest function to send remainders
const sendShowReminders = inngest.createFunction(
  { id: "send-show-remainders" },
  { cron: "0 */8 * * *" }, // Every 8 hours
  async ({ step }) => {
    const now = new Date();
    const in8Hours = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const windowStart = new Date(in8Hours.getTime() - 10 * 60 * 1000);

    // Prepare remainder tasks

    const remainderTasks = await step.run(
      "prepare-remainder-tasks",
      async () => {
        const shows = await Show.find({
          showTime: { $gte: windowStart, $lte: in8Hours },
        }).populate("movie");

        const tasks = [];

        for (const show of shows) {
          if (!show.movie || !show.occupiedSeats) continue;

          const userIds = [...new Set(Object.values(show.occupiedSeats))];

          if (userIds.length === 0) continue;

          const users = await User.find({ _id: { $in: userIds } }).select(
            "name email"
          );

          for (const user of users) {
            tasks.push({
              userEmail: user.email,
              userName: user.name,
              movieTitle: show.movie.title,
              showTime: show.showTime,
            });
          }
        }
        return tasks;
      }
    );

    if (remainderTasks.length === 0) {
      return { sent: 0, message: "No remainders to send." };
    }

    // Send remainder emails

    const results = await step.run("send-all-remainders", async () => {
      return await Promise.allSettled(
        remainderTasks.map((task) =>
          sendEmail({
            to: task.userEmail,
            subject: `Remainder : Your movie "${task.movieTitle}" starts soon! `,
            body: `
            <div style="font-family: Arial, sans-serif; padding:20px;">
            <h2>Hello ${task.userName},</h2>
            <p>This is a quick remainder that your movie : </p>
            <h3 style="color: #F84565; ">"${task.movieTitle}"</h3>
            <p>
                is scheduled for
                <strong>${new Date(task.showTime).toLocaleDateString("en-US", {
                  timeZone: "Asia/Kolkata",
                })}</strong> at
                <strong>${new Date(task.showTime).toLocaleTimeString("en-US", {
                  timeZone: "Asia/Kolkata",
                })}</strong>
            </p>
            <p>It starts in approximately <strong>8 hours</strong>
            - make sure you're ready!</p><br/>
            <p>Enjoy the show!<br>- Movie.py Team</p>
        </div>`,
          })
        )
      );
    });

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - sent;

    return {
      sent,
      failed,
      message: `Sent ${sent} remainder(s), ${failed} failed`,
    };
  }
);

// Inngest function to send notifications when a new show is added

const sendNewShowNotifications = inngest.createFunction(
  { id: "send-new-show-notifications" },
  { event: "app/show.added" },
  async ({ event }) => {
    const { movieTitle} = event.data;

    const users = await User.find({});

    for (const user of users) {
      const userEmail = user.email;
      const userName = user.name;
      const subject = `New Show Added : ${movieTitle}`;
      const body = `
                <div style="font-family:Arial, sans-serif; padding:20px;">
                    <h2>Hi ${userName}, </h2>
                    <p>We've just added a new show to our library: </p>
                    <h3 style="color: #F84565; " >"${movieTitle}" </h3>
                    <p>Visit our Website</p>
                    <br/>
                    <p>Thanks, <br/> Movie.py Team</p>
                </div>
            `;
      await sendEmail({
        to: userEmail,
        subject,
        body,
      });
    }

    return {message: "Notification sent."}
  }
);

// Create an empty array where we'll export future Inngest functions
export const functions = [
  syncUserCreation,
  syncUserDeletion,
  syncUserUpdation,
  releaseSeatsAndDeleteBooking,
  sendBookingConfirmationEmail,
  sendShowReminders,
  sendNewShowNotifications
];
