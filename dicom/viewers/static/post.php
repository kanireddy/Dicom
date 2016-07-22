<!DOCTYPE html>
<html>
<head>
<script src="https://ajax.googleapis.com/ajax/libs/jquery/1.12.4/jquery.min.js"></script>
<script>
$(document).ready(function(){
    $("button").click(function(){
        $.post("http://localhost/dwv-master/viewers/static/index.html",
        {
          input: "http%3A//localhost/img/IM-0001-0001.dcm",
        },
        function(data,status){
            $(body).html(data);
			alert($(body).html());
        });
    });
});
</script>
</head>
<body>

<button>Send an HTTP POST request to a page and get the result back</button>

<form action="http://localhost/dwv-master/viewers/static/index.html" method="get">
<input type="hidden" name="input" value="http://localhost/img/IM-0001-0001.dcm">
<input type="submit">
</form>

</body>
</html>

