import { clerkClient } from "@clerk/express";
import Booking from "../models/Booking.js";
import Movie from "../models/Movie.js";

// API Controller function to get user bookings

export const getUserBookings = async (requestAnimationFrame,res)=>{
    try{
        const user = requestAnimationFrame.auth().userId;

        const bookings = await Booking.find({user}).populate({
            path:"show",
            populate:{path:"movie"}
        }).sort({createdAt:-1})

        res.json({success: true,bookings})
    }catch(error){
        console.error(error.message);
        res.json({success:false,message:error.message});        
    }
}

// API Controller Function to update favorite movie in clerk user metadata

export const updateFavorite = async (req,res)=>{
    try{
        const {movieId} = req.body;
        const userId = req.auth().userId;

        const user = await clerkClient.users.getUser(userId);

        if(!user.privateMetadata.favorites){
            user.privateMetadata.favorites=[]
        }

        if(!user.privateMetadata.favorites.includes(movieId)){
            user.privateMetadata.favorites.push(movieId);
        }else{
            user.privateMetadata.favorites = user.privateMetadata.favorites.filter(item => item !== movieId)
        }

        await clerkClient.users.updateUserMetadata(userId,{privateMetadata:user.privateMetadata});

        res.json({success:true,message:"Favorite Movies Updated Successfully"})
    } catch(error){
        console.error(error.message);
        res.json({success:false,message:error.message});
    }
}


export const getFavorites = async (req,res)=>{
    try{
        const user = await clerkClient.users.getUser(req.auth().userId)
        const favorites = user.privateMetadata.favorites;

        // Getting movies from database

        const movies = await Movie.find({_id : {$in : favorites}})

        res.json({success:true,movies})
    }catch(error){
        console.error(error.message);
        res.json({success:false,message:error.message});
    }
}