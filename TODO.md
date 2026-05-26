# Ruiru Media House Enhancement Plan

## Phase 1: The Foundation (Structural Layout)
- [x] Clean up duplicated HTML in src/index.html
- [x] Define clear containers for Queen (header), Prince (player), and Subjects (playlist)
- [x] Update src/style.css for fixed Queen and Prince, scrollable Subjects, rounded borders, professional gaps
- [x] Ensure mobile stacks vertically, desktop splits 70/30
- [x] Update src/script.js for dynamic margin adjustments on mobile

## Phase 2: The Joker's Mirror (Settings Design)
- [x] Enhance Joker screen in src/index.html with 80/20 split (left action area, right command sidebar)
- [x] Update src/style.css for split layout overlay
- [x] Modify src/script.js to populate action area based on commands (Profile, Customization, Security)

## Phase 3: The Customization Studio (Live Preview)
- [x] Add 50/50 split in Customization sub-page for controls and live mirror
- [x] Update src/style.css for studio split and instant reflection
- [x] Update src/script.js for real-time mirror updates on control changes

## Phase 4: The Architect Mode (Stretching & Dragging)
- [ ] Integrate drag-and-drop library (e.g., SortableJS via CDN)
- [ ] Add resize handles and visual indicators in src/style.css
- [ ] Update src/script.js for resizing and drag logic, position tracking

## Phase 5: The Eternal Memory (Individual Saves)
- [ ] Modify src/script.js to track and save widths/heights/positions to localStorage
- [ ] Add logic to load saved settings on page load
- [ ] Ensure compatibility with Firebase auth for user-specific saves

## Followup Steps
- [ ] Update README.md with new features
- [ ] Test responsive layout and functionality

I need you to implement a new feature on my web app ("Ruiru Media House"). The design should look similar to Gemini’s sidebar layout, where user profile/support links are kept cleanly at the bottom. 

Please read the instructions carefully and update my HTML, CSS, and JavaScript files:

### 1. Sidebar UI Update & Divider Line
- At the bottom of my existing dark sidebar menu, add a sticky footer container containing a "❤️ Support Our Work" clickable item.
- Directly ABOVE this support item, add a horizontal divider line (<hr>) separating the upper menu from this lower support area.
- CRITICAL CSS REQUIREMENT: The divider line must span almost the entire width from left-to-end, but it MUST NOT fully touch the left or right edges. Give it a tiny, clean gap (e.g., using side margins or widths) so it looks suspended, premium, and modern against the dark sidebar background. Use a subtle semi-transparent white border-top color (like `rgba(255,255,255,0.15)`).

### 2. Central Support Modal System
When the "Support Our Work" button is clicked, an overlay modal must appear directly in the absolute center of the screen. This modal needs to handle TWO separate demonstration workflows:

- **Workflow 1 (General Support):** A default form view where the user can input their M-Pesa Phone Number and an Amount (KES).
- **Workflow 2 (Project-Specific Support):** Include a tab, toggle, or selection switcher to change to a project view. When switched, a dropdown arrow menu appears, allowing the user to select a specific project. The dropdown list must include:
  1. 🎥 Equipment Purchase (Cameras, Mics)
  2. 🤝 Community Charity Outreach
  3. 💻 Web Platform Development
  - Ensure that after submission, the selected project value is captured separately from general fund tracking for demonstration purposes.

### 3. Submission & 90-Second Simulation Countdown
- Once the user fills out either form and clicks the action button, the input fields must hide immediately.
- Replace the view with a simulated M-Pesa STK push listening screen containing a loading spinner.
- Display a clear instruction text telling the user: "Please check your phone. A prompt will appear on your screen asking you to enter your M-Pesa PIN to authorize the payment."
- Start an automated **90-second countdown timer** showing seconds remaining. 
- If the countdown reaches 0, close the modal view or alert that the session listening state has closed. 

Please provide the modular Vanilla HTML, CSS, and JavaScript codes cleanly organized so I can drop them right into my current project.

s
I need you to create the backend architecture for my M-Pesa integration file (`mpesa-integration`). Please ignore any previous structures. I want exactly TWO main support categories in this code, and each category must contain BOTH a Paybill and a Buy Goods configuration. 

This means there will be exactly FOUR specific API template blocks for me to fill out with credentials.

Please structure the code cleanly with placeholders (`YOUR_SHORTCODE`, `YOUR_TILL`, `YOUR_PASSKEY`, etc.) according to this exact breakdown:

### 1. Category One: GENERAL SUPPORT
- **Configuration A (Paybill):** Set up a template for `CustomerPayBillOnline`. Use a generic account number placeholder like "SUPPORT".
- **Configuration B (Buy Goods / Till):** Set up a template for `CustomerBuyGoodsOnline` using a Till Number structure.

### 2. Category Two: PROJECT-SPECIFIC SUPPORT
- **Configuration C (Paybill):** Set up a template for `CustomerPayBillOnline`. In this payload, ensure the `AccountNumber` field dynamically captures the specific project name passed from the frontend dropdown (e.g., Equipment, Charity, or Development).
- **Configuration D (Buy Goods / Till):** Set up a template for `CustomerBuyGoodsOnline`. In this payload, include the selected project name inside the M-Pesa tracking metadata array so the fund allocation is strictly recorded.

### ⚙️ Core Logic Requirements:
- Create an entry function that receives the user's choice: which category they chose, and whether they are using 'paybill' or 'till'. 
- Include the standard Daraja API OAuth token generation function.
- Include the standard STK Push (Lipa Na M-Pesa Online) POST request template that handles these 4 specific logic pathways.

Provide this as a clean, highly-commented backend template so I can easily drop in my live keys once Safaricom approves my applications.

v
I have a structural question regarding the code you have generated so far, and I need you to answer it clearly BEFORE writing or modifying any code. 

**Question:**
Have you fully connected the frontend "Support Our Work" modal functions (the button, forms, selections, and 90-second countdown) with the backend `mpesa-integration` file you designed? Specifically: when I finally input my live API keys into the backend, will the frontend forms automatically trigger those live M-Pesa STK push payloads without any extra coding?

---

### 🛠️ Instructions Based on Your Answer:

- **IF YES:** Do not write any new code. Simply explain to me clearly how your frontend JavaScript file is passing the user's data (Phone, Amount, Category, and Paybill/Till choice) to your backend M-Pesa functions.

- **IF NO:** Please create the connecting "bridge" function now. 
  1. Write the frontend JavaScript `fetch()` or `Axios` API call inside my form submission event listener.
  2. This call must securely send the phone number, amount, selected project category, and the payment type mode ('paybill' or 'till') to the backend M-Pesa script.
  3. Ensure that the moment the backend script responds with a success signal, the frontend immediately triggers the 90-second countdown screen we designed.

Please keep your response focused entirely on this connection engine so that the moment I type in my keys, the entire loop works perfectly automatically!

I need you to update the dynamic video rendering engine on my "Ruiru Media House" web app. My videos are stored in Firebase and loaded dynamically via URLs into a single reusable layout template. Every video that loads automatically gets the "Share" and "Download" buttons. I want to add a "Save" button to this dynamic row.

Please update the code according to these exact specifications:

### 1. HTML Template Update
- Inside the reusable template layout where the `Share` and `Download` buttons are dynamically rendered, append the new Save button:
  ```html
  <button id="saveVideoBtn" class="action-sub-btn">
      <span class="icon">🔖</span> Save
  </button>

  The button element and core logic have already been added, but I need you to refine the CSS styling and the visual feedback transition. 

Please update the styles and JavaScript classes based on these exact requirements:

### 1. Mirror the CSS Appearance Completely
- Ensure the `#saveVideoBtn` uses the exact same class styles as the existing `Share` and `Download` buttons. It must look completely uniform in width, height, padding, border-radius, background color, text color, and hover states. 

### 2. Add the Green State Style
Create a success utility class in my CSS file for when the video metadata is successfully saved:
```css
.action-sub-btn.saved-active {
    background-color: #22c55e !important; /* Success Green */
    color: #ffffff !important;
    border-color: #22c55e !important;
}
Connect the JavaScript Visual Toggle
In the click event handler, right where the code successfully executes localStorage.setItem() to store the dynamic title, metadata, and Firebase URL, inject the line to add this green active class:

JavaScript
document.getElementById('saveVideoBtn').classList.add('saved-active');
document.querySelector('#saveVideoBtn .btn-text').textContent = 'Saved';
Also, make sure that when a new video loads from Firebase, the code checks localStorage. If that video's URL is already saved, automatically add the .saved-active class so the button defaults to green for that video.

I need you to adjust the layout order for my sidebar menu item for "Saved Videos" and its dynamic display logic on the "Ruiru Media House" platform.

Please read the specific layout sequence requirements carefully and update the component placement:

### 1. Sidebar UI Update (Layout Sequence)
- Locate the horizontal divider line (`<hr>`) at the bottom of the sidebar that separates the upper main menu from the bottom footer section.
- I want BOTH the **Saved Videos** button and the **Support Our Work** button to live **BELOW** this divider line.
- Use this exact order for the HTML layout:
  ```html
  <hr class="sidebar-divider">

  <div class="sidebar-footer">
      <a href="#" id="savedVideosNavBtn" class="nav-link layout-saved-btn">
          <span class="icon">🔖</span>
          <span class="text">Saved Videos</span>
      </a>

      <a href="#" id="supportBtn" class="support-link">
          <span class="icon">❤️</span>
          <span class="text">Support Our Work</span>
      </a>
  </div>
  2. Main Content View Swap Logic
When a user clicks #savedVideosNavBtn, use the exact same dynamic content routing logic that handles my "Entertainment" or "Sermons LIVE" tabs.

It must hide or clear out the active video player framework or home feed cards from the main screen display panel and dynamically render my saved video collection inside a container element named #savedVideosLibraryContainer.

3. JavaScript Library Rendering Engine (LocalStorage Feed)
Implement a function called renderSavedVideosLibrary() that fires when the user clicks the Saved Videos tab:

Step A: Read the savedVideos array from browser localStorage using JSON.parse(localStorage.getItem('savedVideos')) || [].

Step B (Empty State Check): If there are no bookmarked items in the array, do not leave a blank screen. Display a clean, centered typography notice: "You haven't saved any videos yet. Click the 'Save' button under any video to bookmark it here!"

Step C (Grid Component Output): If data exists, loop through the array and render them inside a beautiful, responsive video grid. Each card component must dynamically display:

The saved title text (e.g., "MEWAK PRESENTATION").

The captured metadata string (Date & Category).

A "Watch Now" Button (▶️): When clicked, this button must grab that card's unique Firebase Storage source URL, feed it directly into the main frame player template, and immediately redirect/switch the user's view to the player page so they can watch the video.

A "Remove" Button (🗑️): When clicked, it must splice/remove that specific object from the localStorage array based on its matching Firebase URL, save the updated array, and immediately call renderSavedVideosLibrary() to refresh the grid layout seamlessly.

I have attached a screenshot of the current sidebar layout. The "Saved Videos" and "Support Our Work" buttons at the bottom look incorrect—they are sitting horizontally next to each other, they don't match the rest of the navigation menu, and the white box styling looks out of place. 

I need you to completely REDESIGN the CSS and restructure the HTML for this bottom section so that it flows perfectly with the rest of the web app.

Please apply these exact layout design updates:

### 1. Vertical Layout Alignment (HTML Restructure)
- Remove any horizontal row containers wrapping those two bottom buttons. 
- Ensure that both elements are coded as individual block-level or flex links so they arrange themselves vertically in a straight column layout, exactly like "Home", "Entertainment", and "Bible Study".

### 2. Matching the Global Navigation Styles (CSS Styling)
- **Consistency:** Strip away the unique white background box, custom borders, and weird paddings from the "Support Our Work" button. 
- **Uniform Design:** Apply the exact same CSS classes, typography (font-size, font-weight), padding (e.g., vertical and horizontal alignment), text color, and icon spacing to BOTH `#savedVideosNavBtn` and `#supportBtn` that the upper links use.
- **Hover States:** Ensure that when a user hovers over either "Saved Videos" or "Support Our Work", they display the exact same subtle background highlight animation (e.g., a transparent white or grey overlay) that the rest of the navigation categories use.

### 3. The Final Expected HTML Structure Sequence
The final layout sequence at the bottom of the sidebar must follow this clean, vertical hierarchy:
```html
<hr class="sidebar-divider">

<div class="sidebar-footer">
    <a href="#" id="savedVideosNavBtn" class="nav-link">
        <span class="icon">🔖</span>
        <span class="text">Saved Videos</span>
    </a>

    <a href="#" id="supportBtn" class="nav-link">
        <span class="icon">❤️</span>
        <span class="text">Support Our Work</span>
    </a>
</div>

I need you to implement the final page-switching and data-fetching logic for the "Saved Videos" menu item on the "Ruiru Media House" web app. 

Currently, when I click links like "Entertainment" or "Sermons LIVE", the application seamlessly switches pages/views by hiding the previous page content and loading a new dynamic view in the main content panel. I want the "Saved Videos" button to behave EXACTLY like that.

Please update the JavaScript click event listener for `#savedVideosNavBtn` with these precise operational rules:

### 1. Trigger the Page-Shifting View (Just Like Entertainment)
- When `#savedVideosNavBtn` is clicked, instantly run my application's view-switching or routing function.
- Completely clear or hide the active homepage feed, category lists, or active video player frame from the main display layout (the content window next to the sidebar).
- Inject or make visible a new dedicated content section container named `#savedVideosView`.

### 2. Instant LocalStorage Fetching Engine
The exact millisecond the view switches open, the code must run a rendering loop that queries the browser memory:
- **Fetch the Data:** Pull the current array from browser storage using:
  `const savedList = JSON.parse(localStorage.getItem('savedVideos')) || [];`
- **Render the Layout Elements:** - If `savedList` is completely empty, render a clean, centered typography layout message: *"You haven't saved any videos yet. Click the 'Save' button under any video to bookmark it here!"*
  - If `savedList` contains bookmarked media data, dynamically iterate through the array and render them as uniform video card elements matching the exact CSS grid design of my home/entertainment video feeds.

### 3. Maintain Sidebar State Styling
- Ensure that upon clicking, the active navigation CSS class (the subtle highlight background indicating which page is currently open) moves to the "Saved Videos" tab, exactly the way it updates when moving from "Home" to "Entertainment".

Please output only the complete JavaScript click event listener block and the rendering loop logic required to execute this seamless page shifting and instant storage fetching!
The "Saved Videos" feature is currently not working or shifting pages when clicked. To fix this cleanly, I want to isolate all browser memory functions into a brand new, dedicated file to decouple it from my main logic loops.

Please perform this architectural restructure exactly as specified:

### 1. Create a Dedicated `localstorage.js` File
Create a new file in the project root folder named exactly `localstorage.js`. Move all functions handling local browser memory data into this file. 
- Ensure that this script handles data per client device locally—meaning whether a user opens the platform on a mobile phone, tablet, or laptop browser, it automatically links to that specific device's internal storage engine.
- Inside this file, export or define these globally accessible core methods:
  - `getSavedVideos()`: Standard routine to read and parse the unique device storage array data (`JSON.parse(localStorage.getItem('savedVideos')) || []`).
  - `saveVideoToDevice(videoObj)`: Checks for duplicates by Firebase URL and appends new dynamic video data payloads into the client memory array.
  - `removeVideoFromDevice(videoUrl)`: Splices out bookmarked files directly via source URLs and commits the updated array structure back to the device.

### 2. Connect the Script to `index.html`
- Instruct me on exactly where to link this new file in my HTML layout (e.g., adding `<script src="localstorage.js"></script>` right before my main app script) so all variables are safely loaded.

### 3. Implement the Force Page-Shift Event (Fixing the Bug)
In my main interface navigation script, completely rewrite the `#savedVideosNavBtn` click event listener. It must execute two sequential events perfectly without failing:
- **Event A (Forced UI View Swap):** The exact moment a user clicks "Saved Videos", it must explicitly clear the display layout. Hide the active video frame container, empty the home grid elements, and force the app’s content window to reveal the dynamic `#savedVideosView` panel. This shift must look identical to selecting "Entertainment" or "Sermons LIVE".
- **Event B (Run Device Fetch):** Once the view shifts open, immediately invoke the display routine:
  ```javascript
  const localFeeds = getSavedVideos();
  // Loop through localFeeds and dynamically build the video card grid inside #savedVideosView

  Dynamic Interactive Grid Assembly
Inside the newly opened page container, if localFeeds contains saved media data, loop through them and render uniform cards matching my site theme. Every device card must include:

A functional Watch Now action that loads its stored Firebase resource URL directly into the player frame and swaps the display to the main player view.

A functional Delete action that invokes removeVideoFromDevice(), clears out the record, and automatically re-renders the viewport array smoothly without forcing an entire window reload.