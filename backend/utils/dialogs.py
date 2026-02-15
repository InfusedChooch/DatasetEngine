# Create backend/utils/dialogs.py
import tkinter as tk
from tkinter import filedialog
import os

def open_file_dialog():
    """Opens a native Windows window to select the yaml file"""
    # Hide the main tkinter window
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True) # Bring the window to the foreground
    
    file_path = filedialog.askopenfilename(
        title="Select the data.yaml file",
        filetypes=[("YAML files", "*.yaml *.yml"), ("All files", "*.*")]
    )
    
    root.destroy()
    return file_path

def open_folder_dialog():
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    folder_path = filedialog.askdirectory(
        title="Select Output Folder"
    )
    root.destroy()
    return folder_path