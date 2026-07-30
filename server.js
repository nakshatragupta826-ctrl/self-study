// ================= LOAD ENV FIRST =================
require("dotenv").config({ path: __dirname + "/.env" });

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const db = require("./config/db");
const nodemailer = require("nodemailer");
const cron = require("node-cron");


const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));


app.use("/uploads", express.static("uploads"));

const materialRoutes = require("./routes/materials");
app.use("/api/materials", materialRoutes);

// ================= OPENROUTER CONFIG =================

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:5000",  // required by OpenRouter
    "X-Title": "Self Study Project"
  }
});

// ================= CHAT ROUTE =================

app.post("/api/chat", async (req, res) => {
  try {
    const message = req.body.message || "";

    if (!message) {
      return res.json({ reply: "Please enter a message." });
    }

    const completion = await openrouter.chat.completions.create({
      model: "meta-llama/llama-3-8b-instruct",
      messages: [   // ✅ THIS LINE IS IMPORTANT
        { role: "system", content: "You are a helpful study assistant." },
        { role: "user", content: message }
      ],
      max_tokens: 200
    });

    const reply = completion.choices[0].message.content;

    res.json({ reply });

  } catch (error) {
    console.error("OpenRouter Full Error:", error.response?.data || error.message);
    res.status(500).json({ reply: "Error connecting to AI." });
  }
});


app.post("/api/summarize", async (req, res) => {
  try {
    const { text, length, tone } = req.body;

    if (!text || text.length > 3000) {
      return res.json({
        summary: "Text too long. Please limit input to about 2500-3000 characters."
      });
    }

    let lengthInstruction = "";
    if (length === "short") lengthInstruction = "Provide a short summary in 3-4 sentences.";
    if (length === "medium") lengthInstruction = "Provide a medium length summary.";
    if (length === "long") lengthInstruction = "Provide a detailed summary.";

    let toneInstruction = "";
    if (tone === "academic") toneInstruction = "Use academic language.";
    if (tone === "simple") toneInstruction = "Use simple and easy language.";
    if (tone === "bullet") toneInstruction = "Provide the summary in bullet points.";

    const completion = await openrouter.chat.completions.create({
      model: "meta-llama/llama-3-8b-instruct",
      messages: [
        {
          role: "system",
          content: "You are a helpful study assistant that summarizes text."
        },
        {
          role: "user",
          content: `${lengthInstruction} ${toneInstruction}

Summarize the following text:

${text.substring(0, 2500)}`
        }
      ],
      max_tokens: 300
    });

    const summary = completion.choices[0].message.content;

    res.json({ summary });

  } catch (error) {
    console.error("Summarizer Full Error:", error.response?.data || error.message);
    res.status(500).json({ summary: "Error generating summary." });
  }
});

// ================= SMART QUIZ ROUTE =================

app.post("/api/quiz", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.length > 2500) {
      return res.json({
        quiz: "Please enter topic or limit text to about 2000-2500 characters."
      });
    }

    const completion = await openrouter.chat.completions.create({
      model: "meta-llama/llama-3-8b-instruct",
      messages: [
        {
          role: "system",
          content: "You are a helpful study assistant that creates multiple choice quizzes."
        },
        {
          role: "user",
          content: `
Generate 5 multiple choice questions (MCQs) based on the following content.

Rules:
- Each question must have 4 options (A, B, C, D)
- Clearly mark the correct answer at the end of each question
- Format neatly

Content:
${text.substring(0, 2000)}
          `
        }
      ],
      max_tokens: 500
    });

    const quiz = completion.choices[0].message.content;

    res.json({ quiz });

  } catch (error) {
    console.error("Quiz Error:", error.response?.data || error.message);
    res.status(500).json({ quiz: "Error generating quiz." });
  }
});

// ================= TIMETABLE =================

// Save timetable image
app.post("/api/timetable/upload", (req, res) => {
    const { userId, image } = req.body;

    const sql = "INSERT INTO timetable_images (user_id, image) VALUES (?, ?)";
    
    db.query(sql, [userId, image], (err, result) => {
        if(err) return res.status(500).json(err);
        res.json({ message: "Image saved" });
    });
});

// Save day end time
app.post("/api/timetable/day", (req, res) => {
    const { userId, day, endTime ,email} = req.body;

    const sql = "INSERT INTO timetable_days (user_id, day, end_time, email) VALUES (?, ?, ?, ?)";
    
    db.query(sql, [userId, day, endTime, email], (err, result) => {
        if(err) return res.status(500).json(err);
        res.json({ message: "Day timing saved" });
    });
});

// Get timetable for user
app.get("/api/timetable/:userId", (req, res) => {
    const userId = req.params.userId;

    const imageSql = "SELECT * FROM timetable_images WHERE user_id = ?";
    const daysSql = "SELECT * FROM timetable_days WHERE user_id = ?";

    db.query(imageSql, [userId], (err, imageResult) => {
        if(err) return res.status(500).json(err);

        db.query(daysSql, [userId], (err, daysResult) => {
            if(err) return res.status(500).json(err);

            res.json({
                image: imageResult,
                days: daysResult
            });
        });
    });
});

// Delete timetable
app.delete("/api/timetable/:userId", (req, res) => {
    const userId = req.params.userId;

    const sql = "DELETE FROM timetable WHERE user_id = ?";
    db.query(sql, [userId], (err, result) => {
        if(err) return res.status(500).json(err);
        res.json({ message: "Deleted successfully" });
    });
});

app.post("/api/assignments", (req, res) => {
    const { userId, subject, due ,email} = req.body;

    const sql = `
        INSERT INTO assignments (user_id, subject, due_date, email)
        VALUES (?, ?, ?, ?)
    `;

    db.query(sql, [userId, subject, due,email], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ message: "Assignment added" });
    });
});

app.get("/api/assignments/:userId", (req, res) => {
    const userId = req.params.userId;

    const sql = "SELECT * FROM assignments WHERE user_id = ? ORDER BY due_date ASC";

    db.query(sql, [userId], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json(result);
    });
});

app.put("/api/assignments/:id", (req, res) => {
    const id = req.params.id;

    const sql = "UPDATE assignments SET turned_in = TRUE WHERE id = ?";

    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ message: "Updated successfully" });
    });
});

app.post("/api/grades", (req, res) => {

    const { userId, subject, slot, exam, total, obtained, average } = req.body;

    const sql = `
        INSERT INTO grades
        (user_id, subject, slot, exam, total_marks, marks_obtained, class_average)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql,
        [userId, subject, slot, exam, total, obtained, average],
        (err, result) => {

            if (err) return res.status(500).json(err);

            const percentage = (Number(obtained) / Number(total)) * 100;

            // ✅ FETCH USER EMAIL FROM USERS TABLE
            const userSql = "SELECT email FROM users WHERE id = ?";

            db.query(userSql, [userId], (err2, userResult) => {

                if (err2) return console.error(err2);

                const userEmail = userResult[0]?.email;

                if (!userEmail) {
                    console.log("No email found for user");
                    return res.json({ message: "Grade added successfully" });
                }

                // ✅ SEND MAIL TO USER EMAIL
                if (percentage < 40) {

                    const mailOptions = {
                        from: process.env.EMAIL_USER,
                        to: userEmail,
                        subject: "⚠ Low Score Alert",

                        text: `
🚨 LOW PERFORMANCE ALERT

Subject: ${subject}
Exam: ${exam}
Score: ${percentage.toFixed(2)}%

----------------------------------

⚠ This is below 40%.

📌 What you should do:
- Revise weak topics
- Practice previous questions
- Focus more on this subject

Don't worry — improve from here 💪
                        `
                    };

                    transporter.sendMail(mailOptions, (error, info) => {
                        if (error) {
                            console.error("Low Score Email Error:", error);
                        } else {
                            console.log("Low Score Alert Sent to user");
                        }
                    });
                }

                res.json({ message: "Grade added successfully" });

            });

        }
    );
});

app.get("/api/grades/:userId", (req, res) => {

    const userId = req.params.userId;

    const sql = "SELECT * FROM grades WHERE user_id = ? ORDER BY exam, slot";

    db.query(sql, [userId], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json(result);
    });
});

app.put("/api/grades/:id", (req, res) => {

    const id = req.params.id;
    const { subject, slot, total, obtained, average } = req.body;

    const sql = `
        UPDATE grades
        SET subject = ?, slot = ?, total_marks = ?, 
            marks_obtained = ?, class_average = ?
        WHERE id = ?
    `;

    db.query(sql, 
        [subject, slot, total, obtained, average, id], 
        (err, result) => {
            if (err) return res.status(500).json(err);
            res.json({ message: "Grade updated" });
        }
    );
});


// ================= OTHER ROUTES =================

app.use("/api/auth", require("./routes/auth"));


cron.schedule("* * * * *", () => {

    const now = new Date();
    const currentTime =
        now.getHours().toString().padStart(2, "0") + ":" +
        now.getMinutes().toString().padStart(2, "0");

    const sql = `
    SELECT * FROM timetable_days
    WHERE end_time = ? AND notified = FALSE
    `;

    db.query(sql, [currentTime], (err, results) => {

        if (err) return console.error(err);

        results.forEach(row => {

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: row.email,
                subject: "Study Day Completed 🎉",
                text: "Great job! You completed today's study schedule."
            };

            transporter.sendMail(mailOptions, (error, info) => {

                if (!error) {
                    console.log("Timetable email sent");

                    db.query(
                        "UPDATE timetable_days SET notified = TRUE WHERE id = ?",
                        [row.id]
                    );
                }

            });

        });

    });

});

// Assignment Reminder Cron - Runs Every Day at 9 AM
cron.schedule("* * * * *", () => {

    const sql = `
    SELECT *,
    DATEDIFF(due_date, CURDATE()) AS days_left
    FROM assignments
    WHERE
        DATEDIFF(due_date, CURDATE()) <= 3
        AND DATEDIFF(due_date, CURDATE()) >= 0
        AND turned_in = FALSE
        AND reminded = FALSE
    `;

    db.query(sql, (err, results) => {

        if (err) return console.error(err);

        results.forEach(row => {

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: row.email,
                subject: "Assignment Reminder 📚",
                text: `
Assignment: ${row.subject}
Due Date: ${new Date(row.due_date).toDateString()}

⚠ Only ${row.days_left} day(s) left!
                `
            };

            transporter.sendMail(mailOptions, (error) => {

                if (!error) {
                    db.query(
                        "UPDATE assignments SET reminded = TRUE WHERE id = ?",
                        [row.id]
                    );
                }

            });

        });

    });

});

// Weekly Summary - Every Sunday at 8 PM
cron.schedule("0 20 * * 0", () => {

    const sql = `
    SELECT email,
COUNT(*) as totalExams,
AVG((marks_obtained / total_marks) * 100) as avgScore
FROM grades
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY email
    `;

    db.query(sql, (err, results) => {

        if (err) return console.error(err);

        results.forEach(row => {

            const avg = row.avgScore ? Number(row.avgScore).toFixed(2) : 0;

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: row.email,
                subject: "📊 Weekly Study Report",

                text: `
WEEKLY REPORT

Total Exams: ${row.totalExams}
Average Score: ${avg}%

Remark:
${avg >= 75 ? "Excellent 🔥" :
  avg >= 50 ? "Good 👍" :
  "Needs Improvement ⚠"}

Keep going 🚀
                `
            };

            transporter.sendMail(mailOptions, () => {
                db.query("UPDATE grades SET weekly_sent = TRUE WHERE email = ?", [row.email]);
            });

        });

    });

});

// Monthly Report - 1st day of every month at 9 AM
cron.schedule("0 9 1 * *", () => {

    const assignmentSql = `
    SELECT
        COUNT(*) as totalAssignments,
        SUM(turned_in) as completed
    FROM assignments
    `;

    db.query(assignmentSql, (err, aResult) => {

        if (err) return console.error(err);

        // ✅ DEFINE VARIABLES HERE
        const total = aResult[0].totalAssignments;
        const completed = aResult[0].completed || 0;
        const pending = total - completed;

        // ❌ NO forEach here

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER,
            subject: "📚 Monthly Report",

            text: `

📚 SELF STUDY — MONTHLY REPORT

━━━━━━━━━━━━━━━━━━━━━━

👋 Hello!

Here’s your performance summary for this month:

📊 ASSIGNMENT STATUS
✔ Completed: ${completed}
⏳ Pending: ${pending}

━━━━━━━━━━━━━━━━━━━━━━

📈 PERFORMANCE INSIGHT

${completed === total
  ? "🎉 Amazing! You completed all your assignments this month!"
  : completed >= total / 2
  ? "👍 Good progress! You're on track, keep pushing."
  : "⚠ You have many pending tasks. Let's improve next month."}

━━━━━━━━━━━━━━━━━━━━━━

💡 SMART SUGGESTIONS
• Plan your week in advance  
• Avoid last-minute submissions  
• Stay consistent with your timetable  

━━━━━━━━━━━━━━━━━━━━━━

🚀 Keep learning. Keep growing.

– Self Study App

`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (!error) {
                console.log("Monthly sent");
            }
        });

    });

});
// ================= START SERVER =================

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});