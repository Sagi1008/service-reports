# דיאגרמות UML — Oficiency

מסמך זה מדגים את המערכת הקיימת דרך ארבע הדיאגרמות המרכזיות של UML, כל אחת עונה על שאלה אחרת. ראו [PRD.md](PRD.md) לדרישות ו-[SRS.md](SRS.md) לפירוט טכני מלא.

---

## 1. Use Case Diagram — מה המערכת עושה עבור המשתמשים

עונה על: "מה יכול כל סוג משתמש לעשות?"

```mermaid
flowchart LR
    Tech((טכנאי))
    Admin((מנהל))

    subgraph SYS[מערכת Oficiency]
        UC1[יצירת דוח שירות]
        UC2[עריכת/שמירת דוח]
        UC3[ייצוא PDF]
        UC4[שיתוף דוח]
        UC5[יצירה משימוש בתבנית]
        UC6[ניהול ציוד]
        UC7[מסירת ציוד]
        UC8[העלאת נוהל/מסמך]
        UC9[הרשמה כטכנאי חדש]
        UC10[יצירת/מחיקת תיקייה]
        UC11[אישור/ביטול טכנאי]
        UC12[יצירת תבנית]
    end

    Tech --> UC1
    Tech --> UC2
    Tech --> UC3
    Tech --> UC4
    Tech --> UC5
    Tech --> UC6
    Tech --> UC7
    Tech --> UC8
    Tech --> UC9
    Tech --> UC12

    Admin --> UC10
    Admin --> UC11
    Admin -.-> UC1
    Admin -.-> UC2

    UC1 -. include .-> UC5
    UC2 -. include .-> UC3
```

**הערות:**
- `Admin` "יורש" את כל היכולות של `טכנאי` (הוא יכול לערוך כל דוח, לא רק את שלו) — ביוזם דיאגרמת Use Case מלאה זה מיוצג כ-generalization בין האקטורים, אך הושמט כאן לשם פשטות.
- UC11 (אישור/ביטול טכנאי) מוגבל אך ורק למנהל — אין נתיב חלופי.
- UC10 (ניהול תיקיות) מוגבל אך ורק למנהל.

---

## 2. Class Diagram — המבנה הסטטי (State Object)

עונה על: "איך המידע בזיכרון בנוי ומתייחס אחד לשני?" — זו לא דיאגרמת מחלקות OOP קלאסית (האפליקציה לא כתובה עם מחלקות), אלא ייצוג של אובייקט ה-state הגלובלי `S` וישויות הליבה שלו, כפי שהן מוגדרות ב-`Js/api.js`.

```mermaid
classDiagram
    class AppState {
        +reports: Map~id, Report~
        +folders: Map~name, id[]~
        +templates: Map~id, Template~
        +equipment: Map~id, EquipmentItem~
        +currentUser: User
        +currentId: string
    }

    class Report {
        +id: string
        +title: string
        +customer: string
        +site: string
        +serviceType: string
        +folder: string
        +createdBy: string
        +tasks: Task[]
        +images: string[]
        +tech: TechInfo
        +customerSig: string
    }

    class Task {
        +id: string
        +type: "task"|"range"|"section"
        +description: string
        +status: string
        +comments: string
    }

    class Template {
        +id: string
        +name: string
        +folder: string
        +tasks: Task[]
    }

    class EquipmentItem {
        +id: string
        +name: string
        +status: "storage"|"active"|"repair"
        +currentHolder: string
    }

    class TeamDirectoryEntry {
        +email: string
        +name: string
    }

    AppState "1" --> "*" Report : holds
    AppState "1" --> "*" Template : holds
    AppState "1" --> "*" EquipmentItem : holds
    Report "1" *-- "0..*" Task : composed of
    Template "1" *-- "0..*" Task : composed of
    Report "0..*" --> "0..1" Report : folder groups (via S.folders)
```

**הערה על Composition:** `Task` מיוצג כ-composition (יהלום מלא) בתוך `Report` ו-`Template` — משימה לא קיימת ללא הדוח/תבנית שמכיל אותה, ואין לה קיום עצמאי או מזהה שמשותף בין שני דוחות.

---

## 3. Sequence Diagram — שמירת דוח (התהליך הקריטי ביותר במערכת)

עונה על: "מה בדיוק קורה, ובאיזה סדר, כשטכנאי לוחץ 'שמור'?"

```mermaid
sequenceDiagram
    actor Tech as טכנאי
    participant UI as reports.js
    participant API as api.js
    participant Storage as Firebase Storage
    participant FS as Firestore

    Tech->>UI: לחיצה על "שמור"
    UI->>UI: canEditReport(r)?
    alt אין הרשאה
        UI-->>Tech: toast שגיאה
    else יש הרשאה
        UI->>UI: collectTasks(), collectReportAppendices()
        UI->>API: apiSaveReport(report)
        par העלאת תמונות/חתימות (מקבילי)
            API->>Storage: uploadBytes(img_0..n)
            API->>Storage: uploadBytes(sig_tech.png)
            API->>Storage: uploadBytes(sig_cust.png)
        end
        Storage-->>API: download URLs
        API->>API: derive status (pending/in_progress/completed)
        API->>FS: setDoc(reports/{id}, sanitize(payload))
        FS-->>API: ack
        API-->>UI: {id, ...payload}
        UI->>UI: clearDraft(id)
        UI-->>Tech: toast "הדו״ח נשמר בהצלחה"
        FS--)UI: onSnapshot fires on all connected clients
    end
```

**הערה:** ה-`onSnapshot` בתחתית מדגים את הסנכרון החי בין מכשירים — כל לקוח מחובר אחר מקבל את השינוי כמעט מיידית, לא רק המכשיר ששמר.

---

## 4. Activity Diagram — אשף "דוח חדש"

עונה על: "מה זרימת ההחלטות ביצירת דוח חדש?"

```mermaid
flowchart TD
    Start((התחלה)) --> Step1[שלב 1: בחירת סוג טיפול]
    Step1 --> Step1b[שלב 1ב: שם הדוח]
    Step1b --> Step2[שלב 2: בחירת אתר/תיקייה]
    Step2 --> Decision{סוג טיפול = תקופתי?}
    Decision -->|כן| Step3[שלב 3: בחירת תבנית]
    Decision -->|לא| Confirm[אישור ויצירה]
    Step3 --> Confirm
    Confirm --> CreateLocal[יצירת דוח בזיכרון S.reports]
    CreateLocal --> Persist[persist מקומי + Firestore]
    CreateLocal --> OpenEditor[פתיחת עורך הדוח]
    Persist --> AsyncSave[apiSaveReport ברקע]
    AsyncSave --> End((סוף))
    OpenEditor --> End
```

---

## סיכום — איזו דיאגרמה מתי

| שאלה | דיאגרמה |
|---|---|
| מה כל משתמש יכול לעשות? | Use Case |
| איך הנתונים מאורגנים בזיכרון? | Class |
| מה סדר הפעולות בזרימה קריטית אחת? | Sequence |
| מה זרימת ההחלטות בתהליך מרובה-שלבים? | Activity |
