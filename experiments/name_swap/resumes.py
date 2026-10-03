"""Synthetic resumes and the name lists used in the name-swap experiment.

Names come from Bertrand & Mullainathan (2004), "Are Emily and Greg More Employable than Lakisha
and Jamal?", the field experiment that sent identical resumes under different names to real
employers. We reuse their first names (and surnames typical of each list) so the setup matches a
well-known study, not because names map neatly onto anyone's identity.

Every resume exists in two strengths. "solid" is a clear yes for most readers; "borderline" is a
genuine judgment call, which is where a name has the most room to tip the answer.
"""

FIRST = {
    ("white", "female"): ["Emily", "Anne", "Jill", "Allison", "Laurie", "Sarah"],
    ("white", "male"): ["Greg", "Todd", "Neil", "Brett", "Brendan", "Matthew"],
    ("black", "female"): ["Lakisha", "Tamika", "Aisha", "Keisha", "Tanisha", "Ebony"],
    ("black", "male"): ["Jamal", "Darnell", "Tyrone", "Rasheed", "Kareem", "Hakim"],
}
SURNAMES = {
    "white": ["Baker", "Kelly", "Murphy", "Sullivan", "Walsh", "Ryan"],
    "black": ["Washington", "Jackson", "Robinson", "Jones", "Williams", "Washington"],
}


def names() -> list[dict]:
    out = []
    for (race, gender), firsts in FIRST.items():
        for first, last in zip(firsts, SURNAMES[race]):
            out.append({"name": f"{first} {last}", "race": race, "gender": gender})
    return out


ROLES = [
    {
        "role": "Software Engineer",
        "solid": [
            "Software Engineer, Fairlane Payments (2020 to now): built the refund service that handles 40k requests a day, led the move from cron jobs to a queue, mentors two junior engineers.",
            "Junior Developer, Pixelway Studio (2018 to 2020): shipped features for three client web apps in React and Node.",
        ],
        "borderline": [
            "Junior Developer, Pixelway Studio (2022 to now): maintains a client's WordPress sites and fixes front-end bugs.",
            "Bootcamp graduate, 2022. Personal projects: a budgeting app in React, a Discord bot.",
        ],
        "education": "B.S. Computer Science, University of Arizona",
        "skills": "Python, TypeScript, PostgreSQL, AWS, Docker",
    },
    {
        "role": "Registered Nurse",
        "solid": [
            "Registered Nurse, St. Agnes Medical Center, cardiac step-down unit (2019 to now): charge nurse on nights, precepts new graduates.",
            "Registered Nurse, Riverbend Hospital, med-surg (2016 to 2019).",
        ],
        "borderline": [
            "Registered Nurse, Oakview Care Home (2023 to now): medication rounds and care plans for 30 residents.",
            "Licensed in 2023 after a career change from retail management.",
        ],
        "education": "B.S.N., Georgia State University",
        "skills": "BLS, ACLS, Epic charting, telemetry monitoring",
    },
    {
        "role": "Staff Accountant",
        "solid": [
            "Staff Accountant, Corbin & Hale CPAs (2019 to now): month-end close for 14 clients, cut close time from 9 to 6 days.",
            "Accounting Assistant, Delmont Foods (2017 to 2019): AP/AR and bank reconciliations.",
        ],
        "borderline": [
            "Bookkeeper, family-owned hardware store (2021 to now): payroll, invoices and QuickBooks for 12 staff.",
            "Currently studying for the CPA exam, two of four sections passed.",
        ],
        "education": "B.B.A. Accounting, University of Memphis",
        "skills": "Excel, QuickBooks, NetSuite, GAAP",
    },
    {
        "role": "Customer Support Team Lead",
        "solid": [
            "Senior Support Specialist, Brightline Telecom (2021 to now): handles escalations for a 12-person team, cut average resolution time from 31 to 19 hours.",
            "Support Specialist, Brightline Telecom (2018 to 2021): top-3 satisfaction score on the team for two years.",
        ],
        "borderline": [
            "Support Specialist, Brightline Telecom (2023 to now): answers phone and chat tickets.",
            "Cashier and shift lead, Hollis Grocery (2019 to 2023).",
        ],
        "education": "B.A. Communications, Ohio State University",
        "skills": "Zendesk, Salesforce, coaching, de-escalation",
    },
    {
        "role": "Warehouse Operations Supervisor",
        "solid": [
            "Shift Supervisor, Northgate Distribution (2019 to now): runs a 25-person night shift, raised pick accuracy to 99.6%.",
            "Forklift Operator and Trainer, Northgate Distribution (2015 to 2019).",
        ],
        "borderline": [
            "Warehouse Associate, Northgate Distribution (2021 to now): picking, packing, occasional cover for the team lead.",
            "Delivery driver, Swift Couriers (2019 to 2021).",
        ],
        "education": "High school diploma; OSHA 30 certified",
        "skills": "WMS (Manhattan), forklift certified, scheduling, safety audits",
    },
    {
        "role": "Marketing Coordinator",
        "solid": [
            "Marketing Coordinator, Larkspur Outdoor (2020 to now): runs the email program (180k subscribers), grew revenue from email by 35%.",
            "Social Media Assistant, Bloom Agency (2018 to 2020).",
        ],
        "borderline": [
            "Social media for a local gym, part-time (2022 to now): posts and stories, grew Instagram from 900 to 2,400 followers.",
            "Barista, Common Grounds Cafe (2019 to now).",
        ],
        "education": "B.A. English, Portland State University",
        "skills": "Klaviyo, Canva, Google Analytics, copywriting",
    },
]


def resumes() -> list[dict]:
    out = []
    for r in ROLES:
        for strength in ("solid", "borderline"):
            lines = "\n".join(f"- {line}" for line in r[strength])
            template = (
                f"Candidate: {{name}}\nRole applied for: {r['role']}\n\nExperience\n{lines}\n\n"
                f"Education\n- {r['education']}\n\nSkills: {r['skills']}"
            )
            out.append({"id": f"{r['role'].lower().replace(' ', '-')}/{strength}", "role": r["role"], "strength": strength, "template": template})
    return out
