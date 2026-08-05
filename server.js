import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 3000;
const SITE_PASSWORD = process.env.SITE_PASSWORD || "##";

app.use(cors());
app.use(express.json({limit:"50mb"}));
app.use(express.static(path.join(__dirname,"public")));


const transporters = new Map();

let stopSending = false;



function getTransporter(email, appPassword){

    const cleanEmail = email.toLowerCase().trim();

    const key = `${cleanEmail}_${appPassword}`;


    if(!transporters.has(key)){


        const transporter = nodemailer.createTransport({

            host:"smtp.gmail.com",

            port:587,

            secure:false,

            auth:{
                user:cleanEmail,
                pass:appPassword
            },

            pool:true,

            maxConnections:1,

            maxMessages:100,

            connectionTimeout:30000,

            socketTimeout:60000,

            tls:{
                rejectUnauthorized:true
            }

        });


        transporters.set(key,transporter);

    }


    return transporters.get(key);

}



function sleep(ms){

    return new Promise(resolve=>setTimeout(resolve,ms));

}



function convertHtmlToText(html=""){

return html
.replace(/<style[\s\S]*?<\/style>/gi,"")
.replace(/<script[\s\S]*?<\/script>/gi,"")
.replace(/<br\s*\/?>/gi,"\n")
.replace(/<\/p>/gi,"\n\n")
.replace(/<[^>]*>/g,"")
.replace(/&nbsp;/g," ")
.replace(/&amp;/g,"&")
.trim();

}





app.post("/api/auth",(req,res)=>{

const {password}=req.body;


if(password===SITE_PASSWORD){

return res.json({
success:true
});

}


res.status(401).json({
success:false,
message:"Incorrect password"
});


});






app.post("/api/verify",async(req,res)=>{


const {
email,
appPassword
}=req.body;


try{


const transporter =
getTransporter(email,appPassword);


await transporter.verify();


res.json({

success:true,

message:"SMTP verified"

});


}
catch(error){


res.status(401).json({

success:false,

message:error.message

});


}


});







app.post("/api/send-stream",async(req,res)=>{


res.setHeader(
"Content-Type",
"text/event-stream"
);

res.setHeader(
"Cache-Control",
"no-cache"
);

res.setHeader(
"Connection",
"keep-alive"
);



const {

email,

appPassword,

senderName,

subject,

messageBody,

recipients

}=req.body;



if(!email || !appPassword || !Array.isArray(recipients)){


res.write(`data:${JSON.stringify({

success:false,

error:"Invalid data"

})}\n\n`);


return res.end();

}



stopSending=false;



const transporter =
getTransporter(email,appPassword);



const senderEmail =
email.toLowerCase().trim();



for(let i=0;i<recipients.length;i++){



if(stopSending){

res.write(`data:${JSON.stringify({

success:false,

error:"Stopped"

})}\n\n`);

break;

}



const receiver =
recipients[i]?.trim();


if(!receiver) continue;



try{


const isHTML =
/<[a-z][\s\S]*>/i.test(messageBody);



const mailOptions={


from:
senderName
?
`"${senderName}" <${senderEmail}>`
:
senderEmail,


to:receiver,


subject:subject


};



if(isHTML){

mailOptions.html=messageBody;

mailOptions.text=
convertHtmlToText(messageBody);


}else{


mailOptions.text=messageBody;


}



await transporter.sendMail(mailOptions);



res.write(`data:${JSON.stringify({

success:true,

recipient:receiver,

index:i+1

})}\n\n`);



}

catch(error){


console.log(
"MAIL ERROR:",
receiver,
error.message
);


res.write(`data:${JSON.stringify({

success:false,

recipient:receiver,

error:error.message

})}\n\n`);


}




// 500ms delay

if(i < recipients.length-1){

await sleep(500);

}



}



res.write("data:[DONE]\n\n");

res.end();


});







app.post("/api/stop",(req,res)=>{


stopSending=true;


res.json({

success:true,

message:"Stopped"

});


});







if(process.env.NODE_ENV !== "production"){

app.listen(PORT,()=>{

console.log(
`Server running on ${PORT}`
);

});

}


export default app;
