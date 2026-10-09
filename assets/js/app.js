document.addEventListener("keyup", function(e){

    if(e.target.id === "searchInput"){

        let value = e.target.value.toLowerCase();

        document.querySelectorAll("tbody tr").forEach(row=>{

            row.style.display =
            row.innerText.toLowerCase().includes(value)
            ? ""
            : "none";

        });

    }

});

document.addEventListener("DOMContentLoaded",function(){

let search=document.getElementById("searchEmployee");

if(search){

search.addEventListener("keyup",function(){

let value=this.value.toLowerCase();

let rows=document.querySelectorAll("#attendanceTable tr");

rows.forEach(function(row){

row.style.display=row.innerText.toLowerCase().includes(value)

? ""

: "none";

});

});

}

});