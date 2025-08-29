
const timeFormat = (minutes) =>{
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hrs}h ${mins}m`;
}

export default timeFormat